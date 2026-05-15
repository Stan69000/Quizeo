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

const browser = await chromium.launch({ headless: true });
const report = [];

for (const vp of viewports) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(900);

  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const interactive = Array.from(document.querySelectorAll('button, a, input, select, textarea, [role="button"]'));
    const tooSmallTargets = interactive
      .map(el => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, text: (el.textContent || '').trim().slice(0, 40) };
      })
      .filter(i => i.w > 0 && i.h > 0 && (i.w < 44 || i.h < 44));

    const check = (selector) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      return nodes.map(el => {
        const r = el.getBoundingClientRect();
        return {
          selector,
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      });
    };

    const tracked = [
      ...check('.qz-home'),
      ...check('.qz-hero'),
      ...check('.qz-actions'),
      ...check('.quiz-body'),
      ...check('.cin-body'),
      ...check('.net-screen'),
      ...check('.mini-player'),
      ...check('.modal')
    ];

    const overflowing = tracked.filter(r => r.left < -1 || r.right > vw + 1);

    return {
      viewport: { vw, vh },
      doc: {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        scrollHeight: doc.scrollHeight,
        clientHeight: doc.clientHeight,
        bodyScrollWidth: body.scrollWidth,
      },
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
      tooSmallTargetCount: tooSmallTargets.length,
      tooSmallTargetSample: tooSmallTargets.slice(0, 10),
      trackedOverflowCount: overflowing.length,
      trackedOverflow: overflowing.slice(0, 10),
    };
  });

  report.push({ viewport: vp, home: metrics });

  const quickPlay = page.getByRole('button', { name: /Jouer maintenant/i });
  if (await quickPlay.count()) {
    await quickPlay.first().click();
    await page.waitForTimeout(2200);
    const quizMetrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const vw = window.innerWidth;
      const tracked = Array.from(document.querySelectorAll('.quiz-body, .quiz-qcm, .quiz-buzzers, .cin-body, .net-screen')).map(el => {
        const r = el.getBoundingClientRect();
        return { cls: el.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      });
      const overflowing = tracked.filter(r => r.left < -1 || r.right > vw + 1);
      return {
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
        horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
        trackedOverflowCount: overflowing.length,
        trackedOverflow: overflowing.slice(0, 10),
      };
    });
    report[report.length - 1].quiz = quizMetrics;
  }

  await context.close();
}

await browser.close();
await fs.writeFile('qa-screenshots/metrics.json', JSON.stringify(report, null, 2));
console.log('Metrics written to qa-screenshots/metrics.json');
