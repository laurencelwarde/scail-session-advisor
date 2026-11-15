# SCAIL Session Advisor

A Claude Code plugin that displays a real-time session advisor panel with model info, token usage, cost estimates, and session handoff capabilities.

## Features

- **Model Display** - Shows current Claude model (opus/sonnet/haiku) with color coding
- **Effort Level** - Displays current reasoning effort (low/medium/high/max)
- **Token Usage** - Real-time token percentage with visual progress bar
- **Cost Estimates** - Estimated session cost based on token usage
- **Session Duration** - How long you've been working
- **Tool Statistics** - Most-used tools in current session
- **Workflow Pattern Detection** - Detects repeated patterns and suggests skills
- **Break Reminders** - Gentle reminder after 45 minutes
- **Session Handoff** - One-click copy of session context for continuing in a new session

## Installation

### From Marketplace (recommended)

```bash
/plugin install scail-session-advisor --marketplace laurencelwarde/scail-session-advisor
```

### Local Development

Clone and run with the plugin directory flag:

```bash
git clone https://github.com/laurencelwarde/scail-session-advisor.git
claude --plugin-dir ./scail-session-advisor
```

Or copy to your Claude Code plugins folder:

```bash
# Windows
cp -r scail-session-advisor ~/.claude/plugins/

# Mac/Linux  
cp -r scail-session-advisor ~/.claude/plugins/
```

Then restart Claude Code.

## Usage

The panel opens automatically when you start a session. You can also toggle it with:

```
/sa
```

### Handoff

Press `h` or click the Handoff button to copy a summary of your current session to the clipboard. This includes:
- Current model and effort level
- Session duration and token usage
- Top tools used
- Last prompt context

Paste this into a new session to continue where you left off.

## Panel Display

```
opus high 45m 67% ████████░░░░ $12.34       Scail Session Advisor
Read:45 Edit:23 Bash:12  Search & Edit(3x)
[ [h] Handoff ]
```

## License

MIT
