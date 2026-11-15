export type ModelSuggestion = 'opus' | 'sonnet' | 'haiku'
export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export interface ToolStats {
  [tool: string]: number
}

export interface WorkflowPattern {
  name: string
  tools: string[]
  count: number
  lastSeen: number
}

export interface AdvisorState {
  model: ModelSuggestion
  effort: EffortLevel
  tokenPercent: number
  tokensUsed: number
  tokensRemaining: number
  lastPrompt: string
  handoffSummary: string | null
  estimatedCost: number
  toolStats: ToolStats
  recentTools: string[]
  sessionStartTime: number
  lastActivityTime: number
  breakReminderShown: boolean
  workflowPatterns: WorkflowPattern[]
  suggestedSkill: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'scail-session-advisor': {
      state: AdvisorState
    }
  }
}
