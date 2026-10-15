/* global document, innerWidth */
import console from 'node:console';
import {chromium,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(pathToFileURL(resolve('artifacts/doctor-demo/bilingual/index.html')).href);
 for(const kind of ['capabilities','patient-journey']){
  await page.locator('#tab-'+kind).click();
  const panel=page.locator('#'+kind),video=panel.locator('video');
  await expect(panel).toBeVisible();
  await expect.poll(()=>video.evaluate(v=>v.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate(v=>{v.currentTime=24;v.muted=true;});
  await panel.locator('.language').selectOption('hi');
  await expect.poll(()=>video.evaluate(v=>v.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(()=>video.evaluate(v=>Math.abs(v.currentTime-24)<1)).toBe(true);
  expect(await video.evaluate(v=>[...v.textTracks].filter(t=>t.mode==='showing').map(t=>t.label))).toEqual(['Hinglish']);
  expect(await video.evaluate(v=>v.textTracks[1].cues[0].text)).not.toMatch(/[\u0900-\u097f]/);
  await video.evaluate(v=>v.play());
  await expect.poll(()=>video.evaluate(v=>v.currentTime)).toBeGreaterThan(24.4);
  await panel.locator('.language').selectOption('en');
  await expect.poll(()=>video.evaluate(v=>!v.paused&&v.readyState>=2)).toBe(true);
  expect(await video.evaluate(v=>v.currentTime)).toBeGreaterThan(24);
  await panel.locator('.captions').uncheck();
  expect(await video.evaluate(v=>[...v.textTracks].every(t=>t.mode==='disabled'))).toBe(true);
  await panel.locator('.captions').check();
  await panel.locator('.speed').selectOption('0.85');
  expect(await video.evaluate(v=>v.playbackRate)).toBe(0.85);
  await video.evaluate(v=>v.pause());
  await page.screenshot({path:resolve('artifacts/doctor-demo/bilingual/work/player-'+kind+'.png'),fullPage:true});
  console.log(kind,'passed language switching, time preservation, subtitles, playback and speed');
 }
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
}finally{await browser.close();}
