# Record Demo — Claude Code Plugin

Automated browser demo recorder. Describe what you want to show, and Claude generates a step-by-step recording script, previews it, then captures an MP4 via Playwright.

## Install

```
/plugin add <github-url>
```

## First-Time Setup

Install Playwright (once per machine):

```bash
PLUGIN_DIR=$(find ~/.claude/plugins/cache -type f -name "demo.mjs" -path "*record-demo*" -exec dirname {} \; | head -1)
cd "$PLUGIN_DIR" && npm install
```

## Usage

Tell Claude what to record:

> "Record a demo of the login flow on localhost:3000"

Or invoke the skill directly:

> `/record-demo`

Claude will:
1. Discuss the steps with you
2. Generate a steps JSON file
3. Show a preview for confirmation
4. Record the MP4

## What It Can Do

- Navigate to URLs (local files, localhost, external sites)
- Click, type, scroll, hover, press keys
- Handle multi-tab link clicks
- Configurable viewport size (default 1920x1200)
- Brisk pacing with customizable delays
- Debug screenshots on selector failures

## Requirements

- Node.js 18+
- Playwright (`npm install` handles this)
