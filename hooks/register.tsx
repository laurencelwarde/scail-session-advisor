import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { AdvisorState, ToolStats, WorkflowPattern } from '../types'

const PANE_ID = 'scail-session-advisor'
const BREAK_REMINDER_MINUTES = 45
const PATTERN_WINDOW = 10

// Pricing per 1M tokens (Opus pricing)
const INPUT_COST_PER_M = 15.00
const OUTPUT_COST_PER_M = 75.00

const initialState: AdvisorState = {
  model: 'sonnet',
  effort: 'medium',
  tokenPercent: 0,
  tokensUsed: 0,
  tokensRemaining: 0,
  lastPrompt: '',
  handoffSummary: null,
  estimatedCost: 0,
  toolStats: {},
  recentTools: [],
  sessionStartTime: Date.now(),
  lastActivityTime: Date.now(),
  breakReminderShown: false,
  workflowPatterns: [],
  suggestedSkill: null
}

const advisorState = atom({ plugin: 'scail-session-advisor', key: 'state' } as const, initialState)

// Known workflow patterns
const KNOWN_PATTERNS: { name: string; sequence: string[]; skillSuggestion: string }[] = [
  { name: 'Search & Edit', sequence: ['Grep', 'Read', 'Edit'], skillSuggestion: 'Create skill: search and apply edits' },
  { name: 'Test-Fix Loop', sequence: ['Bash', 'Read', 'Edit', 'Bash'], skillSuggestion: 'Create skill: run tests, fix, rerun' },
  { name: 'Multi-File Refactor', sequence: ['Glob', 'Read', 'Edit', 'Read', 'Edit'], skillSuggestion: 'Create skill: batch refactor' },
  { name: 'Debug Loop', sequence: ['Read', 'Bash', 'Read'], skillSuggestion: 'Create skill: debug with logs' },
  { name: 'Code Review', sequence: ['Bash', 'Read', 'Read', 'Read'], skillSuggestion: 'Create skill: review changes' }
]

function detectWorkflowPatterns(recentTools: string[]): { patterns: WorkflowPattern[]; suggestion: string | null } {
  const detectedPatterns: WorkflowPattern[] = []
  let suggestion: string | null = null

  for (const pattern of KNOWN_PATTERNS) {
    const seq = pattern.sequence
    let matchCount = 0
    for (let i = 0; i <= recentTools.length - seq.length; i++) {
      let matches = true
      for (let j = 0; j < seq.length; j++) {
        if (recentTools[i + j] !== seq[j]) { matches = false; break }
      }
      if (matches) matchCount++
    }
    if (matchCount > 0) {
      detectedPatterns.push({ name: pattern.name, tools: seq, count: matchCount, lastSeen: Date.now() })
      if (matchCount >= 2 && !suggestion) suggestion = pattern.skillSuggestion
    }
  }
  return { patterns: detectedPatterns, suggestion }
}

function estimateCost(tokensUsed: number): number {
  const inputTokens = tokensUsed * 0.7
  const outputTokens = tokensUsed * 0.3
  return (inputTokens / 1_000_000 * INPUT_COST_PER_M) + (outputTokens / 1_000_000 * OUTPUT_COST_PER_M)
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000)
  const hours = Math.floor(mins / 60)
  return hours > 0 ? `${hours}h${mins % 60}m` : `${mins}m`
}

function shortModel(model: string): string {
  if (model.includes('opus')) return 'opus'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('haiku')) return 'haiku'
  return model.split('-')[0] || model
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sa', description: 'Toggle SCAIL Session Advisor panel' })
    void $.ui.open({ id: PANE_ID, title: 'SCAIL Session Advisor', closeOnEscape: true })

    const usage = await $.session.usage()
    const tokens = usage.context?.tokens ?? 0

    await update($, advisorState, s => ({
      ...s,
      tokenPercent: usage.context?.percent ?? 0,
      tokensUsed: tokens,
      tokensRemaining: usage.context?.remaining ?? 0,
      estimatedCost: estimateCost(tokens),
      sessionStartTime: Date.now(),
      lastActivityTime: Date.now()
    }))

    return next(e)
  })

  on('command.run', { command: 'sa' }, async ($) => {
    await $.ui.open({ id: PANE_ID, title: 'SCAIL Session Advisor', closeOnEscape: true, focus: true })
    return { text: 'Session advisor panel toggled.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const now = Date.now()
    const rawState = await read($, advisorState)
    const sessionStart = rawState.sessionStartTime ?? now
    const minutesSinceStart = (now - sessionStart) / 60000

    let showBreakReminder = false
    if (minutesSinceStart >= BREAK_REMINDER_MINUTES && !rawState.breakReminderShown) {
      showBreakReminder = true
      await $.ui.toast(`${formatDuration(now - sessionStart)} session - take a break?`)
    }

    await update($, advisorState, s => ({
      ...s,
      lastPrompt: e.text.slice(0, 200),
      lastActivityTime: now,
      breakReminderShown: showBreakReminder ? true : s.breakReminderShown
    }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const toolName = e.tool
    const result = await next(e)

    const usage = await $.session.usage()
    const tokens = usage.context?.tokens ?? 0

    // Get effort from event if available
    const effortLevel = (e as any).effort?.level

    await update($, advisorState, s => {
      const newStats = { ...s.toolStats }
      newStats[toolName] = (newStats[toolName] || 0) + 1
      const newRecentTools = [...s.recentTools, toolName].slice(-PATTERN_WINDOW * 2)
      const { patterns, suggestion } = detectWorkflowPatterns(newRecentTools)

      return {
        ...s,
        tokenPercent: usage.context?.percent ?? 0,
        tokensUsed: tokens,
        tokensRemaining: usage.context?.remaining ?? 0,
        estimatedCost: estimateCost(tokens),
        toolStats: newStats,
        recentTools: newRecentTools,
        lastActivityTime: Date.now(),
        workflowPatterns: patterns.length > 0 ? patterns : s.workflowPatterns,
        suggestedSkill: suggestion || s.suggestedSkill,
        effort: effortLevel || s.effort
      }
    })

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const rawState = await read($, advisorState)

    // Always get fresh usage on render
    // Apply 1.1x multiplier to account for system overhead not exposed by API
    const usage = await $.session.usage()
    const tokens = usage.context?.tokens ?? 0
    const rawPercent = usage.context?.percent ?? 0
    const tokenPercent = Math.min(rawPercent * 1.1, 100)
    const tokensRemaining = usage.context?.remaining ?? 0

    const state: AdvisorState = {
      ...initialState,
      ...rawState,
      tokenPercent,
      tokensUsed: tokens,
      tokensRemaining,
      estimatedCost: estimateCost(tokens),
      toolStats: rawState.toolStats ?? {},
      recentTools: rawState.recentTools ?? [],
      workflowPatterns: rawState.workflowPatterns ?? [],
      sessionStartTime: rawState.sessionStartTime ?? Date.now(),
      lastActivityTime: rawState.lastActivityTime ?? Date.now()
    }

    // Get real model
    const realModel = await $.session.model()
    const modelShort = shortModel(realModel)

    // Colors
    const modelColor = modelShort === 'opus' ? 'magenta' : modelShort === 'haiku' ? 'green' : 'blue'
    const effortColor = state.effort === 'max' ? 'magenta' : state.effort === 'high' ? 'red' : state.effort === 'low' ? 'green' : 'yellow'
    const tokenColor = state.tokenPercent > 80 ? 'red' : state.tokenPercent > 60 ? 'yellow' : 'green'

    // Progress bar
    const barWidth = 12
    const filled = Math.round((state.tokenPercent / 100) * barWidth)
    const progressBar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)

    // Duration
    const duration = formatDuration(Date.now() - state.sessionStartTime)

    // Top tools (top 3)
    const topTools = Object.entries(state.toolStats).sort((a, b) => b[1] - a[1]).slice(0, 3)

    const handleHandoff = async () => {
      const tools = topTools.map(([t, c]) => `${t}:${c}`).join(' ')
      const summary = `## Handoff\nModel: ${modelShort} | Effort: ${state.effort} | ${duration} | ${state.tokenPercent.toFixed(0)}% tokens | $${state.estimatedCost.toFixed(2)}\nTools: ${tools}\nContext: ${state.lastPrompt || 'N/A'}`
      await $.ui.copy({ text: summary })
      await $.ui.toast('Copied!')
      await $.ui.focus({ requestId: PANE_ID, key: 'handoff' })
    }

    const handleDismissSkill = async () => {
      await update($, advisorState, s => ({ ...s, suggestedSkill: null }))
    }

    // Build compact strings
    const toolsStr = topTools.map(([t, c]) => `${t}:${c}`).join(' ')
    const patternStr = state.workflowPatterns[0] ? `${state.workflowPatterns[0].name}(${state.workflowPatterns[0].count}x)` : ''

    return (
      <Box flexDirection="column" padding={1} gap={1}>
        {/* Row 1: Model, effort, duration, tokens, cost, progress bar */}
        <Box>
          <Text color={modelColor} bold>{modelShort}</Text>
          <Text> </Text>
          <Text color={effortColor}>{state.effort}</Text>
          <Text> </Text>
          <Text dimColor>{duration}</Text>
          <Text> </Text>
          <Text color={tokenColor}>{state.tokenPercent.toFixed(0)}%</Text>
          <Text> </Text>
          <Text color={tokenColor}>{progressBar}</Text>
          <Text> </Text>
          <Text dimColor>${state.estimatedCost.toFixed(2)}</Text>
        </Box>

        {/* Row 2: Tools and pattern */}
        <Box>
          {toolsStr && <Text dimColor>{toolsStr}</Text>}
          {toolsStr && patternStr && <Text dimColor>  </Text>}
          {patternStr && <Text color="yellow">{patternStr}</Text>}
        </Box>

        {/* Row 3: Skill suggestion (if any) + Handoff button */}
        <Box marginTop={1}>
          {state.suggestedSkill && (
            <>
              <Text color="green">{state.suggestedSkill}</Text>
              <Text> </Text>
              <Button key="dismiss" hotkey="d" onPress={handleDismissSkill}>[d]</Button>
              <Text>  </Text>
            </>
          )}
          <Button key="handoff" hotkey="h" autoFocus onPress={handleHandoff}>[h] Handoff</Button>
        </Box>
      </Box>
    )
  })
}
