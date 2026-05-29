import { chromium } from "playwright";
import { resolve } from "path";

const profileDir = resolve("./browser-profile");
const width = 1280, height = 720;

async function inspect() {
  const browser = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width, height },
    args: [`--window-size=${width},${height}`],
  });

  const page = await browser.newPage();
  await page.goto("https://www.notion.so/Welcome-New-Hire-Name-Template-3543f0b3b6ab81adadfef4aa2afec1b6", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // Find all scrollable elements and their classes
  const scrollables = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('*').forEach(el => {
      const style = getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        results.push({
          tag: el.tagName,
          class: el.className.substring(0, 80),
          id: el.id,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        });
      }
    });
    return results;
  });
  console.log("Scrollable elements:", JSON.stringify(scrollables, null, 2));

  // Try clicking in the main content area first, then scrolling
  await page.mouse.click(640, 400);
  await page.waitForTimeout(500);

  await page.screenshot({ path: "page-a0.png" });

  // Scroll by focusing on main content area with mouse position
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `page-a${i}.png` });
  }

  await browser.close();
  console.log("Done.");
}

inspect().catch(console.error);
