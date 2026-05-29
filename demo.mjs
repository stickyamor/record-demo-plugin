import { chromium } from "playwright";
import { readFileSync } from "fs";
import { resolve } from "path";
import { spawn } from "child_process";
import { createInterface } from "readline";

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

function waitForEnter(msg) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(msg, () => { rl.close(); res(); });
  });
}

const stepsFile = getArg("steps", "steps.json");
const output = getArg("output", "demo.mp4");
const width = parseInt(getArg("width", "1920"));
const height = parseInt(getArg("height", "1200"));
const profileDir = resolve(getArg("profile", "./browser-profile"));
const skipSetup = args.includes("--no-setup");
const noConfirm = args.includes("--no-confirm");

const steps = JSON.parse(readFileSync(resolve(stepsFile), "utf-8"));
const firstUrl = steps.find(s => s.action === "navigate")?.url || "about:blank";
const skipSet = new Set();

function estimateStepMs(step) {
  switch (step.action) {
    case "navigate": return (step.pauseAfter || 2000) + 2000;
    case "click": case "click-js": case "click-in-row": return (step.pauseAfter || 1500) + 1500;
    case "click-link": return (step.pauseAfter || 3000) + 1500;
    case "open-url-in-row": return (step.pauseAfter || 2000) + 1500;
    case "scroll": return (step.duration || 1500) + (step.pauseAfter || 1000);
    case "scroll-top": return 1200 + (step.pauseAfter || 1000);
    case "wait": return (step.seconds || 2) * 1000;
    case "press": return (step.pauseAfter || 500) + 200;
    case "hover": return (step.pauseAfter || 1000) + 500;
    case "type": return (step.text?.length || 10) * 80 + (step.pauseAfter || 1000);
    case "click-toggle": return (step.pauseAfter || 1500) + 1000;
    case "drag": return (step.duration || 800) + (step.pauseAfter || 1000) + 1000;
    default: return 2000;
  }
}

function stepDetail(step) {
  switch (step.action) {
    case "navigate": {
      const url = step.url === "back" ? "← back" : step.url.replace(/https?:\/\/(www\.)?/, "").substring(0, 45);
      return url.length > 45 ? url + "..." : url;
    }
    case "click": return step.selector.substring(0, 45);
    case "click-js": return `text: "${step.text}"`;
    case "click-in-row": return `row: "${step.rowText}" → "${step.cellPattern}"`;
    case "open-url-in-row": return `row: "${step.rowText}" → url: "${step.urlPattern}"`;
    case "click-link": return step.selector.substring(0, 45);
    case "scroll": return `↓${step.amount || 300}px`;
    case "scroll-top": return "↑ top";
    case "wait": return `${step.seconds || 2}s`;
    case "press": return step.key;
    case "type": return `"${(step.text || "").substring(0, 30)}"`;
    case "hover": return step.selector.substring(0, 45);
    case "click-toggle": return step.text;
    case "drag": return `${step.selector} → (${step.toX}, ${step.toY})`;
    default: return "";
  }
}

function askQuestion(msg) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(msg, (answer) => { rl.close(); res(answer.trim()); });
  });
}

async function confirmSteps() {
  const totalMs = steps.reduce((sum, s) => sum + estimateStepMs(s), 0);
  const totalSec = Math.round(totalMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const timeStr = min > 0 ? `~${min}m ${sec}s` : `~${sec}s`;

  console.log("\n  ┌─────────────────────────────────────────────┐");
  console.log("  │              STEP PREVIEW                   │");
  console.log("  └─────────────────────────────────────────────┘\n");
  console.log("   #   Action              Note / Details");
  console.log("  ───  ──────────────────  ──────────────────────────────────────────");
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const num = String(i + 1).padStart(3);
    const action = (s.action || "").padEnd(18);
    const note = s.note || stepDetail(s);
    console.log(`  ${num}  ${action}  ${note}`);
  }
  console.log("  ───  ──────────────────  ──────────────────────────────────────────");
  console.log(`  Total: ${steps.length} steps | Est. duration: ${timeStr}\n`);

  while (true) {
    const answer = await askQuestion("  [enter] Record  |  [s] Skip steps  |  [q] Quit\n  > ");
    if (answer === "" || answer.toLowerCase() === "y") {
      return true;
    } else if (answer.toLowerCase() === "q") {
      console.log("  Cancelled.\n");
      return false;
    } else if (answer.toLowerCase() === "s") {
      const nums = await askQuestion("  Enter step numbers to skip (e.g. 3,5,7): ");
      nums.split(",").map(n => parseInt(n.trim())).filter(n => !isNaN(n) && n >= 1 && n <= steps.length)
        .forEach(n => skipSet.add(n - 1));
      console.log(`  Skipping steps: ${[...skipSet].map(i => i + 1).sort((a, b) => a - b).join(", ")}\n`);
    } else {
      console.log("  Unknown option. Try again.\n");
    }
  }
}

const CURSOR_INJECT = `
  if (!document.getElementById('demo-cursor-style')) {
    const style = document.createElement('style');
    style.id = 'demo-cursor-style';
    style.textContent = \`
      #demo-cursor {
        position: fixed; top: 0; left: 0; z-index: 999999;
        width: 20px; height: 20px; border-radius: 50%;
        background: rgba(255, 80, 50, 0.6);
        border: 2px solid rgba(255, 80, 50, 0.9);
        pointer-events: none;
        transform: translate(-50%, -50%);
        transition: left 0.3s ease, top 0.3s ease;
      }
      #demo-cursor.clicking {
        transform: translate(-50%, -50%) scale(1.8);
        background: rgba(255, 80, 50, 0.3);
        transition: transform 0.15s ease-out, background 0.15s ease-out;
      }
      #demo-click-ripple {
        position: fixed; z-index: 999998;
        width: 40px; height: 40px; border-radius: 50%;
        border: 2px solid rgba(255, 80, 50, 0.8);
        pointer-events: none;
        transform: translate(-50%, -50%) scale(0);
        opacity: 0;
      }
      #demo-click-ripple.active {
        transform: translate(-50%, -50%) scale(2);
        opacity: 0;
        transition: transform 0.5s ease-out, opacity 0.5s ease-out;
      }
    \`;
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    document.body.appendChild(cursor);
    const ripple = document.createElement('div');
    ripple.id = 'demo-click-ripple';
    document.body.appendChild(ripple);
  }
`;

async function moveCursor(page, x, y) {
  await page.evaluate(([cx, cy]) => {
    const c = document.getElementById('demo-cursor');
    if (c) { c.style.left = cx + 'px'; c.style.top = cy + 'px'; }
  }, [x, y]);
}

async function showClick(page, x, y) {
  await page.evaluate(([cx, cy]) => {
    const c = document.getElementById('demo-cursor');
    const r = document.getElementById('demo-click-ripple');
    if (c) { c.classList.add('clicking'); setTimeout(() => c.classList.remove('clicking'), 300); }
    if (r) {
      r.style.left = cx + 'px'; r.style.top = cy + 'px';
      r.classList.remove('active'); void r.offsetWidth; r.classList.add('active');
      setTimeout(() => r.classList.remove('active'), 600);
    }
  }, [x, y]);
}

async function smoothScroll(page, amount, durationMs = 1500) {
  await page.evaluate(([amt, dur]) => {
    return new Promise((resolve) => {
      const el = document.scrollingElement || document.documentElement;
      const start = el.scrollTop;
      const startTime = performance.now();
      function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }
      function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / dur, 1);
        el.scrollTop = start + amt * easeInOutCubic(progress);
        if (progress < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }, [amount, durationMs]);
  await page.waitForTimeout(200);
}

async function ensureInView(page, loc) {
  await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  let box = await loc.boundingBox().catch(() => null);
  if (!box || box.y < 0 || box.y > height || box.x < 0 || box.x > width) {
    await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      el.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.waitForTimeout(500);
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    box = await loc.boundingBox().catch(() => null);
  }
  return box;
}

async function clickAt(page, selector, pauseAfter = 1500, stepNote = "") {
  const loc = page.locator(selector).first();
  const clickTimeout = 10000;
  const pollInterval = 3000;
  let elapsed = 0;

  while (elapsed < clickTimeout) {
    const visible = await loc.isVisible().catch(() => false);
    if (visible) break;
    elapsed += pollInterval;
    if (elapsed < clickTimeout) {
      console.warn(`    ⏳ ${elapsed / 1000}s — still looking for: "${selector}" (${stepNote})`);
      await page.waitForTimeout(pollInterval);
    }
  }

  if (elapsed >= clickTimeout) {
    const screenshotPath = `./recordings/debug-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    console.error(`    ✗ Selector not found after ${clickTimeout / 1000}s: "${selector}"`);
    console.error(`    📸 Debug screenshot saved: ${screenshotPath}`);
    throw new Error(`Selector not found: ${selector}`);
  }

  const box = await ensureInView(page, loc);
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await moveCursor(page, cx, cy);
    await page.waitForTimeout(400);
    await showClick(page, cx, cy);
    await page.waitForTimeout(200);
    await page.mouse.click(cx, cy);
  } else {
    await loc.click({ force: true, timeout: 5000 });
  }
  await page.waitForTimeout(pauseAfter);
}

async function runSteps(page, context) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (skipSet.has(i)) {
      console.log(`  [${i + 1}/${steps.length}] SKIPPED — ${step.note || step.action}`);
      continue;
    }
    console.log(`  [${i + 1}/${steps.length}] ${step.note || step.action}`);

    try { await page.evaluate(CURSOR_INJECT); } catch {}

    try {
    switch (step.action) {
      case "navigate":
        if (step.url === "back") {
          await page.goBack({ waitUntil: "domcontentloaded" });
        } else {
          await page.goto(step.url, { waitUntil: "domcontentloaded" });
        }
        await page.waitForTimeout(step.pauseAfter || 2000);
        try { await page.evaluate(CURSOR_INJECT); } catch {}
        break;

      case "click":
        await clickAt(page, step.selector, step.pauseAfter || 1500, step.note || "");
        break;

      case "open-url-in-row": {
        const urlResult = await page.evaluate(({ rowText, urlPattern }) => {
          // Search all elements for the row containing rowText
          const all = document.querySelectorAll('*');
          for (const el of all) {
            if (!el.textContent.includes(rowText)) continue;
            // Check links in this element
            const links = el.querySelectorAll('a[href]');
            for (const link of links) {
              if (link.href.match(new RegExp(urlPattern, 'i'))) {
                const r = link.getBoundingClientRect();
                return { url: link.href, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
              }
            }
          }
          // Fallback: search all links on page
          const allLinks = document.querySelectorAll('a[href]');
          for (const link of allLinks) {
            if (link.href.match(new RegExp(urlPattern, 'i'))) {
              // Check if this link is near text containing rowText
              const r = link.getBoundingClientRect();
              if (r.width > 0) {
                return { url: link.href, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, fallback: true };
              }
            }
          }
          return null;
        }, { rowText: step.rowText, urlPattern: step.urlPattern });
        if (urlResult && urlResult.w > 0) {
          console.log(`    → Found URL: ${urlResult.url}${urlResult.fallback ? ' (fallback)' : ''}`);
          await moveCursor(page, urlResult.x, urlResult.y);
          await page.waitForTimeout(300);
          await showClick(page, urlResult.x, urlResult.y);
          await page.waitForTimeout(200);
          // Open URL in same tab to show it
          await page.goto(urlResult.url, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
        } else {
          const sp = `./recordings/debug-${Date.now()}.png`;
          await page.screenshot({ path: sp }).catch(() => {});
          console.error(`    ✗ No URL matching "${step.urlPattern}" found near "${step.rowText}"`);
          console.error(`    📸 Debug screenshot saved: ${sp}`);
        }
        await page.waitForTimeout(step.pauseAfter || 2000);
        break;
      }

      case "click-js": {
        const jsCoords = await page.evaluate((searchText) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            if (walker.currentNode.textContent.trim().includes(searchText)) {
              let el = walker.currentNode.parentElement;
              // Walk up to find a clickable ancestor (link, button, or Notion card)
              for (let i = 0; i < 10; i++) {
                if (!el) break;
                const tag = el.tagName.toLowerCase();
                const role = el.getAttribute('role') || '';
                const cls = el.className || '';
                if (tag === 'a' || tag === 'button' || role === 'button' || role === 'link'
                    || cls.includes('gallery-card') || cls.includes('collection-card')
                    || cls.includes('board-card') || el.getAttribute('data-block-id')
                    || (el.style && el.style.cursor === 'pointer')) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0 && r.y > 0 && r.y < window.innerHeight) {
                    return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag, role, cls: cls.substring(0, 80) };
                  }
                }
                el = el.parentElement;
              }
              // Fallback: click the text element itself
              el = walker.currentNode.parentElement;
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0 && r.y > 0 && r.y < window.innerHeight) {
                return { x: r.x + r.width / 2, y: r.y + r.height / 2, fallback: true };
              }
            }
          }
          return null;
        }, step.text);
        if (jsCoords) {
          if (jsCoords.fallback) console.warn(`    ⚠ Using fallback click (no clickable ancestor found)`);
          else console.log(`    → Found clickable: <${jsCoords.tag}> role=${jsCoords.role}`);
          await moveCursor(page, jsCoords.x, jsCoords.y);
          await page.waitForTimeout(300);
          await showClick(page, jsCoords.x, jsCoords.y);
          await page.waitForTimeout(200);
          await page.mouse.click(jsCoords.x, jsCoords.y);
        } else {
          const sp = `./recordings/debug-${Date.now()}.png`;
          await page.screenshot({ path: sp }).catch(() => {});
          console.error(`    ✗ Text not found in DOM: "${step.text}"`);
          console.error(`    📸 Debug screenshot saved: ${sp}`);
        }
        await page.waitForTimeout(step.pauseAfter || 1500);
        break;
      }

      case "click-in-row": {
        const coords = await page.evaluate(({ rowText, cellPattern }) => {
          // Find all elements that could be rows
          const candidates = document.querySelectorAll('[data-block-id], [class*="notion-collection-item"], [class*="notion-table-view-row"], tr');
          for (const row of candidates) {
            if (!row.textContent.includes(rowText)) continue;
            // Search for the cell matching the pattern
            const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const text = walker.currentNode.textContent.trim();
              if (text.match(new RegExp(cellPattern, 'i'))) {
                let el = walker.currentNode.parentElement;
                // Walk up to find a clickable ancestor
                for (let i = 0; i < 8; i++) {
                  if (!el || el === row) break;
                  const tag = el.tagName.toLowerCase();
                  const role = el.getAttribute('role') || '';
                  if (tag === 'a' || role === 'link' || el.style.cursor === 'pointer') {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                      return { x: r.x + r.width / 2, y: r.y + r.height / 2, found: 'clickable' };
                    }
                  }
                  el = el.parentElement;
                }
                // Fallback: click the text element's parent
                el = walker.currentNode.parentElement;
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  return { x: r.x + r.width / 2, y: r.y + r.height / 2, found: 'fallback' };
                }
              }
            }
            // Also check href attributes on links
            const links = row.querySelectorAll('a[href]');
            for (const link of links) {
              if (link.href.match(new RegExp(cellPattern, 'i'))) {
                const r = link.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  return { x: r.x + r.width / 2, y: r.y + r.height / 2, found: 'href' };
                }
              }
            }
          }
          return null;
        }, { rowText: step.rowText, cellPattern: step.cellPattern });
        if (coords) {
          console.log(`    → Found via: ${coords.found}`);
          await moveCursor(page, coords.x, coords.y);
          await page.waitForTimeout(400);
          await showClick(page, coords.x, coords.y);
          await page.waitForTimeout(200);
          await page.mouse.click(coords.x, coords.y);
        } else {
          const sp = `./recordings/debug-${Date.now()}.png`;
          await page.screenshot({ path: sp }).catch(() => {});
          console.error(`    ✗ Could not find cell matching "${step.cellPattern}" in row "${step.rowText}"`);
          console.error(`    📸 Debug screenshot saved: ${sp}`);
        }
        await page.waitForTimeout(step.pauseAfter || 1500);
        break;
      }

      case "click-link": {
        const loc = page.locator(step.selector).first();
        const linkTimeout = 10000;
        let linkElapsed = 0;
        while (linkElapsed < linkTimeout) {
          const vis = await loc.isVisible().catch(() => false);
          if (vis) break;
          linkElapsed += 3000;
          if (linkElapsed < linkTimeout) {
            console.warn(`    ⏳ ${linkElapsed / 1000}s — still looking for: "${step.selector}" (${step.note || ""})`);
            await page.waitForTimeout(3000);
          }
        }
        if (linkElapsed >= linkTimeout) {
          const sp = `./recordings/debug-${Date.now()}.png`;
          await page.screenshot({ path: sp }).catch(() => {});
          console.error(`    ✗ Selector not found after ${linkTimeout / 1000}s: "${step.selector}"`);
          console.error(`    📸 Debug screenshot saved: ${sp}`);
          throw new Error(`Selector not found: ${step.selector}`);
        }
        const box = await ensureInView(page, loc);
        if (box) {
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          await moveCursor(page, cx, cy);
          await page.waitForTimeout(400);
          await showClick(page, cx, cy);
          await page.waitForTimeout(200);
        }
        const urlBefore = page.url();
        const clickAction = box
          ? page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
          : loc.click({ force: true, timeout: 5000 });
        const [newPage] = await Promise.all([
          context.waitForEvent("page", { timeout: 5000 }).catch(() => null),
          clickAction,
        ]);
        if (newPage) {
          await newPage.waitForLoadState("domcontentloaded").catch(() => {});
          await page.waitForTimeout(step.pauseAfter || 3000);
          await newPage.close();
          await page.waitForTimeout(1000);
        } else {
          await page.waitForTimeout(step.pauseAfter || 2000);
          if (page.url() !== urlBefore) {
            await page.goBack({ waitUntil: "domcontentloaded" });
            await page.waitForTimeout(2000);
          }
        }
        break;
      }

      case "click-toggle": {
        const toggleText = page.locator(`text=${step.text}`).first();
        await toggleText.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(300);
        const toggleBtn = await page.evaluate((txt) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            if (walker.currentNode.textContent.trim() === txt) {
              let el = walker.currentNode.parentElement;
              for (let i = 0; i < 5; i++) {
                if (!el) break;
                const btn = el.querySelector('.notion-list-item-box-left div[role="button"]');
                if (btn) {
                  const r = btn.getBoundingClientRect();
                  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                }
                el = el.parentElement;
              }
            }
          }
          return null;
        }, step.text);
        if (toggleBtn) {
          await moveCursor(page, toggleBtn.x, toggleBtn.y);
          await page.waitForTimeout(400);
          await showClick(page, toggleBtn.x, toggleBtn.y);
          await page.waitForTimeout(200);
          await page.mouse.click(toggleBtn.x, toggleBtn.y);
        }
        await page.waitForTimeout(step.pauseAfter || 1500);
        break;
      }

      case "hover": {
        const loc = page.locator(step.selector).first();
        const box = await loc.boundingBox();
        if (box) await moveCursor(page, box.x + box.width / 2, box.y + box.height / 2);
        await loc.hover();
        await page.waitForTimeout(step.pauseAfter || 1000);
        break;
      }

      case "scroll":
        await smoothScroll(page, step.amount || 300, step.duration || 1500);
        await page.waitForTimeout(step.pauseAfter || 1000);
        break;

      case "type": {
        const loc = page.locator(step.selector).first();
        const box = await loc.boundingBox();
        if (box) {
          await moveCursor(page, box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(300);
          await showClick(page, box.x + box.width / 2, box.y + box.height / 2);
        }
        await loc.click();
        await page.keyboard.type(step.text, { delay: 80 });
        await page.waitForTimeout(step.pauseAfter || 1000);
        break;
      }

      case "wait":
        await page.waitForTimeout((step.seconds || 2) * 1000);
        break;

      case "press":
        await page.keyboard.press(step.key);
        await page.waitForTimeout(step.pauseAfter || 500);
        break;

      case "drag": {
        const dragLoc = page.locator(step.selector).first();
        const dragBox = await ensureInView(page, dragLoc);
        if (dragBox) {
          const startX = dragBox.x + (step.fromX ?? dragBox.width / 2);
          const startY = dragBox.y + (step.fromY ?? dragBox.height / 2);
          const endX = dragBox.x + step.toX;
          const endY = dragBox.y + (step.toY ?? dragBox.height / 2);
          const dragSteps = 30;
          const dragDuration = step.duration || 800;
          const interval = dragDuration / dragSteps;

          await moveCursor(page, startX, startY);
          await page.waitForTimeout(300);
          await showClick(page, startX, startY);
          await page.mouse.move(startX, startY);
          await page.mouse.down();
          await page.waitForTimeout(100);

          for (let s = 1; s <= dragSteps; s++) {
            const t = s / dragSteps;
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            const cx = startX + (endX - startX) * ease;
            const cy = startY + (endY - startY) * ease;
            await page.mouse.move(cx, cy);
            await moveCursor(page, cx, cy);
            await page.waitForTimeout(interval);
          }

          await page.mouse.up();
          await page.waitForTimeout(200);
        }
        await page.waitForTimeout(step.pauseAfter || 1000);
        break;
      }

      case "scroll-top":
        await page.evaluate(() => {
          return new Promise((resolve) => {
            const el = document.scrollingElement || document.documentElement;
            const start = el.scrollTop;
            if (start === 0) { resolve(); return; }
            const dur = Math.min(1200, Math.max(600, start * 0.8));
            const startTime = performance.now();
            function easeInOutCubic(t) {
              return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            }
            function step(now) {
              const elapsed = now - startTime;
              const progress = Math.min(elapsed / dur, 1);
              el.scrollTop = start * (1 - easeInOutCubic(progress));
              if (progress < 1) requestAnimationFrame(step);
              else { el.scrollTop = 0; resolve(); }
            }
            requestAnimationFrame(step);
          });
        });
        await page.waitForTimeout(step.pauseAfter || 1000);
        break;

      default:
        console.warn(`  Unknown action: ${step.action}`);
    }
    } catch (err) {
      console.warn(`  ⚠ Step failed: ${err.message.split('\n')[0]} — continuing...`);
      await page.waitForTimeout(1000);
    }
  }
}

async function runDemo() {
  // ── STEP 1: Setup phase (no recording) ──
  if (!skipSetup) {
    console.log("\n  ┌─────────────────────────────────────────────┐");
    console.log("  │     BROWSER SETUP PHASE (not recording)     │");
    console.log("  └─────────────────────────────────────────────┘\n");
    console.log("  A browser will open. Set up before recording:");
    console.log("  • Log in if the site requires authentication");
    console.log("  • Set any display preferences (dark mode, layout, etc.)");
    console.log("  • Navigate to the starting page\n");
    console.log("  These settings persist in your browser profile");
    console.log("  and apply to all future recordings.\n");

    const setupBrowser = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: { width, height },
      args: [`--window-size=${width},${height}`],
    });

    const setupPage = setupBrowser.pages()[0] || await setupBrowser.newPage();
    await setupPage.goto(firstUrl, { waitUntil: "domcontentloaded" });

    await waitForEnter("  Press ENTER when setup is done... ");
    await setupBrowser.close();

    console.log("\n  Settings saved. Starting recording...\n");
  }

  // ── Confirm steps ──
  if (!noConfirm) {
    const proceed = await confirmSteps();
    if (!proceed) process.exit(0);
  }

  // ── STEP 2: Recording phase ──
  console.log("  ┌─────────────────────────────────────────────┐");
  console.log("  │           RECORDING (don't touch!)          │");
  console.log("  └─────────────────────────────────────────────┘\n");

  const browser = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width, height },
    args: [`--window-size=${width},${height}`],
    recordVideo: { dir: "./recordings", size: { width, height } },
  });

  const page = await browser.newPage();

  // ── Pre-flight: navigate and auto-fix layout ──
  await page.goto(firstUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  // Notion-specific pre-flight (only runs on notion.so / notion.site)
  const isNotion = firstUrl.includes('notion.so') || firstUrl.includes('notion.site');
  if (isNotion) {

  // Auto-switch to dark mode if not already
  const isDark = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const match = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) return parseInt(match[1]) < 100;
    return document.body.classList.contains('dark') || document.querySelector('.notion-dark-theme') !== null;
  });
  if (!isDark) {
    console.log("  Switching to dark mode...");
    // Open Settings & members via sidebar
    const settingsLink = page.locator('div[role="button"]:has-text("Settings")').first();
    await settingsLink.click({ timeout: 3000 }).catch(async () => {
      // Sidebar might be closed, open it first
      await page.keyboard.press("Meta+\\");
      await page.waitForTimeout(1000);
      await page.locator('div[role="button"]:has-text("Settings")').first().click({ timeout: 3000 }).catch(() => {});
    });
    await page.waitForTimeout(1500);
    // Click Appearance in settings
    const appearance = page.locator('text=Appearance').first();
    await appearance.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1000);
    // Click Dark
    const darkBtn = page.locator('text=/^Dark$/').first();
    await darkBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    // Close settings
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
    // Re-navigate to the page
    await page.goto(firstUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
  }

  // Auto-close sidebar if visible
  const sidebarVisible = await page.evaluate(() => {
    const sidebar = document.querySelector('.notion-sidebar-container');
    return sidebar && sidebar.offsetWidth > 10;
  });
  if (sidebarVisible) {
    console.log("  Closing sidebar...");
    await page.keyboard.press("Meta+\\");
    await page.waitForTimeout(1500);
  }

  // Auto-enable full width via Notion's ··· menu
  const isFullWidth = await page.evaluate(() => {
    const frame = document.querySelector('.notion-frame');
    if (!frame) return true;
    const pageContent = frame.querySelector('.notion-page-content');
    if (!pageContent) return true;
    return pageContent.offsetWidth > 900;
  });
  if (!isFullWidth) {
    console.log("  Enabling full width...");
    const moreBtn = page.locator('.notion-topbar-more-button').first();
    await moreBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    const fullWidthToggle = page.locator('text=Full width').first();
    await fullWidthToggle.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
  }

  // Verify sidebar is closed
  const stillVisible = await page.evaluate(() => {
    const sidebar = document.querySelector('.notion-sidebar-container');
    return sidebar && sidebar.offsetWidth > 10;
  });
  if (stillVisible) {
    console.error("\n  ✗ Could not close sidebar automatically.");
    console.error("    Please run without --no-setup and close it manually.\n");
    await browser.close();
    process.exit(1);
  }

  console.log("  ✓ Layout ready — full screen, no sidebar.\n");

  } // end Notion pre-flight

  console.log(`Running ${steps.length} demo steps...`);
  await runSteps(page, browser);

  console.log("Demo complete. Saving video...");
  await page.close();
  const videoPath = await page.video().path();
  await browser.close();

  await new Promise((res, rej) => {
    const ff = spawn("ffmpeg", [
      "-y", "-i", videoPath,
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-movflags", "+faststart", output,
    ], { stdio: "inherit" });
    ff.on("close", (code) => code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)));
  });

  console.log(`\n  ✓ Video saved to: ${output}\n`);
}

runDemo().catch((err) => {
  console.error("Demo failed:", err.message);
  process.exit(1);
});
