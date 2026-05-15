import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const baseUrl = 'http://127.0.0.1:1422';
const viewports = [
  { name: '375x812', width: 375, height: 812 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '3840x2160', width: 3840, height: 2160 },
];

const outDir = 'qa-screenshots';
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

for (const vp of viewports) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);

  await page.screenshot({ path: `${outDir}/home-${vp.name}.png`, fullPage: true });

  const quickPlay = page.getByRole('button', { name: /Jouer maintenant/i });
  if (await quickPlay.count()) {
    await quickPlay.first().click();
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${outDir}/quiz-${vp.name}.png`, fullPage: true });
  }

  await context.close();
}

await browser.close();
console.log('Screenshots generated in qa-screenshots/');
