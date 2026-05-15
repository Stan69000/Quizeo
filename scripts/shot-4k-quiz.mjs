import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 3840, height: 2160 } });
const page = await context.newPage();
await page.goto('http://127.0.0.1:1422', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1200);

const musicBtn = page.getByRole('button', { name: /Blind test musical/i });
if (await musicBtn.count()) {
  await musicBtn.first().click();
  await page.waitForTimeout(1800);
}

await page.screenshot({ path: 'qa-screenshots/quiz-3840x2160-v2.png', fullPage: true });
await browser.close();
console.log('saved qa-screenshots/quiz-3840x2160-v2.png');
