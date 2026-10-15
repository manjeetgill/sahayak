/* global document, setTimeout */
import console from 'node:console';
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('artifacts/doctor-demo/capabilities/work');
mkdirSync(output, { recursive: true });
const scenes = JSON.parse(readFileSync(resolve(output, 'scenes-audio.json'), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: output, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();
const origin = Date.now();
const timeline = [];
try {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#eff4ef;color:#153e30;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  main{height:1080px;padding:64px 110px;background:radial-gradient(ellipse at 90% 0,#d6eadb,transparent 55%)}
  header{display:flex;align-items:center;justify-content:space-between}.brand{font-size:40px;font-weight:850;letter-spacing:-1px}.audience{font-size:17px;letter-spacing:3px;color:#688672;font-weight:750}
  .progress{display:flex;gap:9px;margin-top:36px}.dot{height:4px;flex:1;background:#dce5df;border-radius:5px}.dot.done{background:#207256}
  #scene{animation:appear .4s ease-out}.kicker{font-size:18px;letter-spacing:3px;font-weight:800;color:#478065;margin-top:64px}
  h1{font-size:76px;line-height:1.12;letter-spacing:-2.7px;white-space:pre-line;margin:24px 0 42px;font-weight:800;max-width:1660px}
  .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:26px}.tile{border:1px solid #d3e0d6;background:#ffffffd9;border-radius:24px;padding:30px 32px;min-height:238px;animation:appear .55s ease-out both}
  .tile:nth-child(2){animation-delay:.1s}.tile:nth-child(3){animation-delay:.2s}.num{color:#438763;font-size:18px;font-weight:800}.tile h2{font-size:30px;letter-spacing:-.5px;margin:18px 0 15px}.tile p{font-size:24px;line-height:1.48;color:#587463;margin:0}
  .story{margin-top:35px;display:flex;gap:15px;align-items:center;font-size:20px;color:#648371}.story span{border:1px solid #d3e2d8;border-radius:30px;padding:9px 18px}.story b{color:#91ac98;font-weight:500}
  #caption{position:fixed;left:110px;right:110px;bottom:30px;border-radius:16px;background:#164735;color:#fff;text-align:center;padding:22px 36px;font-size:27px;line-height:1.4;min-height:82px;box-shadow:0 12px 35px #163d3015}
  @keyframes appear{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  </style></head><body><main><header><div class="brand">✚ Sahayak</div><div class="audience">FOR DOCTORS & CLINICS</div></header><div class="progress"></div><section id="scene"></section></main><div id="caption"></div></body></html>`);
  for (const [index, scene] of scenes.entries()) {
    await page.evaluate(
      ({ scene, index, count }) => {
        const esc = (s) =>
          s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        document.querySelector('.progress').innerHTML = Array.from(
          { length: count },
          (_, i) => `<div class="dot ${i <= index ? 'done' : ''}"></div>`,
        ).join('');
        const previous = document.querySelector('#scene');
        const section = previous.cloneNode(false);
        section.innerHTML = `<div class="kicker">${esc(scene.kicker)}</div><h1>${esc(scene.title)}</h1><div class="tiles">${scene.tiles.map(([title, text], i) => `<article class="tile"><span class="num">0${i + 1}</span><h2>${esc(title)}</h2><p>${esc(text)}</p></article>`).join('')}</div><div class="story"><span>Before the visit</span><b>→</b><span>At the clinic</span><b>→</b><span>After the visit</span></div>`;
        previous.replaceWith(section);
        const caption = document.querySelector('#caption');
        caption.textContent = scene.narration[0];
        const weights = scene.narration.map((line) => line.split(/\s+/).length);
        const total = weights.reduce((a, b) => a + b, 0);
        let elapsed = 0;
        scene.narration.forEach((line, i) => {
          if (i) setTimeout(() => (caption.textContent = line), elapsed);
          elapsed += (scene.audioSeconds * 1000 * weights[i]) / total;
        });
      },
      { scene, index, count: scenes.length },
    );
    const started = Date.now();
    await page.waitForTimeout((scene.audioSeconds + 1) * 1000);
    timeline.push({
      ...scene,
      start: (started - origin) / 1000,
      duration: (Date.now() - started) / 1000,
    });
    await page.screenshot({ path: resolve(output, scene.id + '.png') });
    console.log('Recorded', scene.id, flushString(scene.audioSeconds));
  }
  writeFileSync(resolve(output, 'timeline.json'), JSON.stringify(timeline, null, 2));
  const video = page.video();
  await context.close();
  await video.saveAs(resolve(output, 'doctor-demo-raw.webm'));
} finally {
  await context.close();
  await browser.close();
}
function flushString(seconds) {
  return Math.round(seconds + 1) + 's';
}
