# Record Demo — Claude Code Plugin

Automated browser demo recorder for Claude Code. Tell Claude what you want to record, and it generates a step-by-step script, previews it with you, then captures an MP4 via Playwright.

## Install

```
/plugin add stickyamor/record-demo-plugin
```

Dependencies are installed automatically on first use. If you need to set up manually:

```bash
PLUGIN_DIR=$(find ~/.claude/plugins/cache -type f -name "demo.mjs" -path "*record-demo*" -exec dirname {} \; | head -1)
cd "$PLUGIN_DIR" && npm install && npx playwright install chromium
```

## Usage

Just ask Claude to record something:

> "Record a demo of the login flow on localhost:3000"

Or invoke the skill directly:

> `/record-demo`

Claude will:
1. Ask what to record and clarify the steps
2. Generate a steps JSON file
3. Show a preview of all steps for your approval
4. Record the MP4 (using a cost-efficient Sonnet subagent)
5. Let you review and iterate if needed

## Recording Pages That Need Login

If your app requires authentication, run a setup session first:

> "I need to record my dashboard but I need to log in first"

Claude will open a browser window for you to log in manually. The session is saved for future recordings.

## Features

- **10 actions**: navigate, click, type, scroll, hover, press, wait, and more
- **Smart selectors**: IDs, data attributes, roles, text, CSS classes
- **Configurable viewport**: any resolution (defaults to 1920x1200)
- **Debug screenshots**: auto-captured when a step fails
- **Cost-efficient**: recordings run on Sonnet (~80x cheaper than Opus)

## Requirements

- Node.js 18+
- Claude Code with plugin support
