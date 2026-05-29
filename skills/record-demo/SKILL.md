---
name: record-demo
description: Use when the user wants to create a screen recording of a web app walkthrough, demo video, or tutorial by browsing through a site automatically. Triggers on "record", "demo video", "walkthrough video", "screen recording", "browse through and record".
---

# Record Demo

Automated browser demo recorder. You discuss what to record with the user, generate a steps JSON, then hand off to a Sonnet subagent that runs Playwright to capture an MP4.

## Before Anything Else: Check Setup

On first use (or if unsure), verify the environment is ready. Run these checks:

```bash
# 1. Find the plugin engine
PLUGIN_DIR=$(find ~/.claude/plugins/cache -type f -name "demo.mjs" -path "*record-demo*" -exec dirname {} \; | head -1)
echo "Plugin dir: $PLUGIN_DIR"

# 2. Check if node_modules exist
ls "$PLUGIN_DIR/node_modules/.package-lock.json" 2>/dev/null && echo "Dependencies: OK" || echo "Dependencies: MISSING"

# 3. Check if Playwright browser is installed
npx playwright install --dry-run chromium 2>&1 | head -3
```

If dependencies are missing, run:
```bash
cd "$PLUGIN_DIR" && npm install && npx playwright install chromium
```

Tell the user what's happening: "Installing the recording engine dependencies — this is a one-time setup."

## Workflow

### Step 1: Ask what to record

First question — ask the user:
> "What do you want to record?"

Wait for their response. They'll describe the flow (e.g. "the login flow", "claiming rewards in the mailbox", "onboarding walkthrough").

### Step 2: Ask for the URL

Second question — ask the user:
> "What's the URL or HTML file link to record?"

Wait for their response. This could be:
- A local file: `file:///Users/you/project/index.html`
- A dev server: `http://localhost:3000`
- An external site: `https://example.com`

If recording a localhost URL, confirm the dev server is running first. If it's not, help the user start it.

If recording a page that requires login, tell the user:
> "The browser needs to be logged in first. I'll open a setup session — log in manually, then close the browser to save the session."
Then run without `--no-setup` so the user can configure the browser profile.

### Step 3: Generate steps JSON

Write a `<name>-steps.json` file in the **user's current working directory** (not the plugin directory). Each step is an object:

```json
{ "action": "click", "selector": "#my-button", "note": "Click Submit", "pauseAfter": 1000 }
```

**How to find selectors:**
- Ask the user for element IDs or data attributes if they know them
- If the user shares HTML or a URL, inspect the DOM to find stable selectors
- Use `inspect-page.mjs` to scan a page for clickable elements:
  ```bash
  node "$PLUGIN_DIR/inspect-page.mjs" "http://localhost:3000"
  ```

**Selector priority (most to least reliable):**
1. IDs: `#start-btn`
2. Data attributes: `[data-testid='save']`, `[data-panel='inbox']`
3. Role selectors: `role=button[name="Save"]`
4. Text selectors: `text=Submit`
5. CSS classes: `.btn-primary` (least stable)

### Step 4: Preview steps with user

Before recording, show the user a numbered list of all steps with their notes and timing. Example:

```
1. Open app (navigate to localhost:3000)
2. Wait 1s
3. Click Login (1s pause)
4. Type email (0.5s pause)
5. Submit form (2s pause)
...
```

### Step 5: Dry run (test recording)

Run a test recording so the user can review before finalizing.

**Always use a Sonnet subagent** — it costs ~80x less than Opus and handles this perfectly.

**Always save the output MP4 to the user's Downloads folder:** `~/Downloads/<name>.mp4`

First, resolve the plugin directory and steps file path, then spawn:

```
Agent({
  model: "sonnet",
  prompt: "Run this demo recording. Steps:\n\n1. Find the plugin engine:\nPLUGIN_DIR=$(find ~/.claude/plugins/cache -type f -name 'demo.mjs' -path '*record-demo*' -exec dirname {} \\; | head -1)\n\n2. Run the recording:\nnode \"$PLUGIN_DIR/demo.mjs\" --steps /absolute/path/to/<name>-steps.json --output ~/Downloads/<name>.mp4 --no-setup --no-confirm\n\nIMPORTANT: Use absolute paths for both --steps and --output. Output MUST go to ~/Downloads/. Do NOT modify any files. Report success/failure and the output file path.",
  description: "Record demo"
})
```

**Critical flags:**
- `--no-setup` — skip browser profile wizard (use only after first-time login is done)
- `--no-confirm` — skip interactive preview (required for subagent since it can't respond to prompts)
- `--width` / `--height` — viewport size (pass if non-default)

### Step 6: Ask for feedback

After the dry run completes, tell the user where the MP4 is saved and ask:
> "Here's the test recording. Are you happy with it, or do you want to add/change any actions?"

Wait for their response:
- **If happy** → done, the recording is final
- **If they want changes** → update the steps JSON, re-record, and ask again

## Available Actions

| Action | Key Fields | What it does |
|--------|-----------|--------------|
| `navigate` | `url` (or `"back"`) | Go to URL or browser back |
| `click` | `selector` | Click element via Playwright selector |
| `click-js` | `text` | Find visible text, walk up DOM to clickable ancestor, click |
| `click-link` | `selector` | Click link that opens new tab, auto-close tab after |
| `scroll` | `amount`, `duration` | Smooth scroll by pixels (positive = down) |
| `scroll-top` | — | Smooth scroll back to top |
| `type` | `selector`, `text` | Click element then type text character by character |
| `press` | `key` | Press keyboard key (e.g. `Escape`, `Enter`) |
| `hover` | `selector` | Hover over element |
| `drag` | `selector`, `toX`, `toY`, `duration` | Smooth drag from element center to target offset (for sliders, drag-and-drop) |
| `wait` | `seconds` | Pause recording |

Every action supports:
- `note` — label shown in logs and preview (always include for readability)
- `pauseAfter` — milliseconds to wait after the action completes

## Pacing Guidelines

For a brisk, watchable demo:
- `pauseAfter`: 500-800ms after scrolls, 1000-1500ms after clicks, 2000-3000ms for important views
- `scroll duration`: 1000-1200ms
- `wait`: 1-2s max

Avoid long pauses — the viewer should never feel like nothing is happening.

## Error Handling

When a selector isn't found, the engine retries for 10 seconds with warnings:
```
⏳ 3s — still looking for: "#missing-btn" (Click submit)
```

After timeout, it saves a debug screenshot to the output directory as `debug-<timestamp>.png`. If a recording fails:

1. Check the debug screenshot to see what the page actually looks like
2. Common causes: wrong selector, element not visible yet (add a `wait` before it), page didn't load (add `pauseAfter` to the previous navigate step)
3. Fix the steps JSON and re-record

Clean up debug screenshots after a successful recording:
```bash
rm debug-*.png
```

## Common Mistakes

- **Forgetting `--no-confirm`** in the subagent prompt — the recording hangs waiting for keyboard input
- **Using relative paths** in the subagent — the subagent's working directory may differ; always use absolute paths
- **Missing `pauseAfter`** on fast actions — the recording looks rushed and viewers can't follow
- **Not starting the dev server** before recording a localhost URL — navigate step fails or shows blank page
- **Using `click-js` when a CSS selector exists** — `click` with `#id` or `[data-attr]` is faster and more reliable
- **Duplicate text on page** — `text=Submit` matches the first one; use `button:has-text('Submit')` or a data attribute instead
