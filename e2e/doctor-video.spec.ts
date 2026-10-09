import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('record the narrated doctor demo', async ({ browser, baseURL }) => {
  test.skip(process.env.DEMO_VIDEO !== '1', 'Media rendering is opt-in.');
  test.setTimeout(600000);
  const output = resolve('artifacts/doctor-demo/work');
  mkdirSync(output, { recursive: true });
  const scenes = JSON.parse(readFileSync(resolve(output, 'scenes-audio.json'), 'utf8'));
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: output, size: { width: 1920, height: 1080 } },
    baseURL,
  });
  const page = await context.newPage(),
    origin = Date.now();
  page.setDefaultTimeout(15000);
  const timeline: any[] = [];
  try {
    await page.goto('/demo/present');
    await page.getByRole('combobox', { name: 'Clinic view', exact: true }).selectOption('hospital');
    await page.getByLabel('Use fictional consent').check();
    await page.getByRole('button', { name: 'Prepare the demo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play demo', exact: true })).toBeEnabled();
    await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('4000');
    await page.evaluate(() => {
      const main = document.querySelector('main')!;
      main.style.zoom = '1.10';
      main.style.maxWidth = '1520px';
      main.style.setProperty('--stage-height', '445px', 'important');
      const style = document.createElement('style');
      style.textContent = `
   #film-cover{position:fixed;inset:0;z-index:9000;background:radial-gradient(ellipse at 85% 5%,#d7eadb 0,transparent 48%),#eff4ef;color:#153e30;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:72px 110px;box-sizing:border-box}
   #film-cover .brand{font-size:37px;font-weight:850;letter-spacing:-1px}#film-cover .brand small{float:right;font-size:15px;letter-spacing:2px;font-weight:700;color:#698675;padding-top:15px}
   #film-cover .kicker{font-size:18px;letter-spacing:4px;color:#427b60;font-weight:800;margin-top:100px}#film-cover h1{font-size:76px;line-height:1.16;letter-spacing:-3px;white-space:pre-line;max-width:1400px;margin:28px 0 38px}
   #film-cover .lead{font-size:30px;line-height:1.6;max-width:1290px;color:#587261;margin:15px 0 45px}
   #film-cover .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:42px}#film-cover .tile{background:#ffffffb8;border:1px solid #d4e2d8;border-radius:22px;padding:32px;min-height:170px;box-shadow:0 15px 45px #12371d05}
   #film-cover .tile b{display:block;font-size:29px;line-height:1.3;margin:16px 0}#film-cover .tile p{font-size:22px;line-height:1.5;color:#5e7666;margin:0}#film-cover .num{font-size:17px;font-weight:850;color:#468867}
   #film-cover .path{display:flex;gap:18px;align-items:center;margin-top:35px}#film-cover .path span{font-size:23px;background:#fff;padding:20px 26px;border-radius:12px;border:1px solid #dce6de}#film-cover .path i{font-size:25px;color:#6f9b81;font-style:normal}
   #film-cover .cta{display:inline-block;background:#176b50;color:white;padding:25px 34px;border-radius:14px;font-size:29px;font-weight:700;margin-top:28px}
   #film-cover .fine{font-size:18px;color:#6f8575;margin-top:28px}
   #film-caption{position:fixed;z-index:10000;bottom:22px;left:110px;right:110px;border:1px solid #3f6a51;background:#123a2ef2;box-shadow:0 10px 40px #163d3020;border-radius:14px;color:#fff;padding:17px 28px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;pointer-events:none}
   #film-caption b{display:block;color:#98cfad;text-transform:uppercase;letter-spacing:2px;font-size:12px;margin-bottom:5px}#film-caption p{font-size:25px;line-height:1.35;max-width:1500px;margin:auto}
  `;
      document.head.append(style);
      const cover = document.createElement('div');
      cover.id = 'film-cover';
      document.body.append(cover);
      const caption = document.createElement('div');
      caption.id = 'film-caption';
      caption.innerHTML = '<b></b><p></p>';
      document.body.append(caption);
    });
    const wait = (ms: number) => page.waitForTimeout(ms);
    const next = async () => {
      await expect(page.getByRole('button', { name: 'Next step →', exact: true })).toBeEnabled();
      const prior = await page.evaluate(
        () => JSON.parse(sessionStorage.getItem('sahayak.demo.presentation.v1')!).cursor,
      );
      await page.getByRole('button', { name: 'Next step →', exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => JSON.parse(sessionStorage.getItem('sahayak.demo.presentation.v1')!).cursor,
          ),
        )
        .toBe(prior + 1);
      await page.evaluate(() => window.scrollTo(0, 0));
    };
    for (const [index, scene] of scenes.entries()) {
      await page.evaluate(
        ({ scene, index }: any) => {
          const cover = document.getElementById('film-cover')!;
          cover.style.display = scene.type === 'app' ? 'none' : 'block';
          const esc = (s: string) =>
            s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
          const tiles = (entries: string[][]) =>
            '<div class="tiles">' +
            entries
              .map(
                (e, i) =>
                  `<div class="tile"><span class="num">0${i + 1}</span><b>${e[0]}</b><p>${e[1]}</p></div>`,
              )
              .join('') +
            '</div>';
          let content = '';
          if (scene.type === 'problem')
            content = tiles([
              ['Before the visit', 'Messages and calls become another follow-up list.'],
              ['During the visit', 'Arrival, payment and queue updates need coordination.'],
              ['After the visit', 'A patient’s unanswered question can go unnoticed.'],
            ]);
          if (scene.type === 'title')
            content =
              '<p class="lead">From the first message to a follow-up that someone owns.</p><div class="path"><span>Message</span><i>→</i><span>Visit</span><i>→</i><span>Feedback</span><i>→</i><span>Human follow-up</span></div>';
          if (scene.type === 'compare')
            content =
              tiles([
                ['Connect the handovers', 'Message → confirmed appointment → arrival → queue.'],
                [
                  'Keep the doctor in control',
                  'A reviewed note and approved instructions before completion.',
                ],
                [
                  'Close the feedback loop',
                  'A patient’s concern becomes an assigned follow-up task.',
                ],
              ]) +
              '<p class="fine">Compare against the features your current system actually provides. Results depend on clinic setup and staff use.</p>';
          if (scene.type === 'closing')
            content =
              '<p class="lead">For a single doctor or a small clinic team.</p><div class="cta">See your clinic’s complete patient journey.</div><p class="fine">Request a Sahayak walkthrough · Fictional demonstration · Synthetic narration<br/>Live delivery, phone calls and online payments require configured services.</p>';
          cover.innerHTML =
            '<div class="brand">✚ Sahayak <small>DOCTOR DEMONSTRATION</small></div><div class="kicker">' +
            esc(
              scene.kicker ??
                (scene.type === 'closing'
                  ? 'MAKE THE NEXT STEP CLEAR'
                  : 'A CONNECTED PATIENT JOURNEY'),
            ) +
            '</div><h1>' +
            esc(scene.title) +
            '</h1>' +
            content;
          const caption = document.getElementById('film-caption')!;
          caption.querySelector('b')!.textContent =
            `${String(index + 1).padStart(2, '0')} · ${scene.type === 'app' ? 'Fictional clinic · actual saved workflow' : 'Sahayak for doctors'}`;
          caption.querySelector('p')!.textContent = scene.narration[0];
          const words = scene.narration.map((line: string) => line.split(/\s+/).length),
            total = words.reduce((a: number, b: number) => a + b, 0);
          let elapsed = 0;
          scene.narration.forEach((line: string, i: number) => {
            if (i)
              setTimeout(() => {
                caption.querySelector('p')!.textContent = line;
              }, elapsed);
            elapsed += (scene.audioSeconds * 1000 * words[i]) / total;
          });
          window.scrollTo(0, 0);
        },
        { scene, index },
      );
      const started = Date.now();
      timeline.push({ ...scene, start: (started - origin) / 1000 });
      const actions = async () => {
        if (scene.action === 'hello') {
          await wait(1500);
          await next();
        }
        if (scene.action === 'booking') {
          for (let n = 0; n < 6; n++) {
            await wait(1400);
            await next();
          }
        }
        if (scene.action === 'arrival') {
          await wait(1400);
          await next();
          await wait(4300);
          await next();
        }
        if (scene.action === 'waiting') {
          await wait(2500);
          await next();
        }
        if (scene.action === 'consultation') {
          await wait(1500);
          await next();
          await wait(4300);
          await next();
        }
        if (scene.action === 'approval') {
          await wait(5000);
          await page.getByLabel('I have reviewed this fictional note').check();
          await page
            .getByRole('button', { name: 'Approve practice note & continue', exact: true })
            .click();
          await page.getByRole('button', { name: 'Pause', exact: true }).click();
          await expect(
            page.getByRole('button', { name: 'Next step →', exact: true }),
          ).toBeEnabled();
          await page.evaluate(() => window.scrollTo(0, 0));
        }
        if (scene.action === 'finish') {
          await wait(1500);
          await next();
          await wait(5500);
          await next();
        }
        if (scene.action === 'feedback') {
          await wait(3500);
          await next();
        }
        if (scene.action === 'handoff') {
          await wait(2500);
          await next();
          await expect(
            page.getByText('Assigned to the doctor — awaiting follow-up', { exact: true }),
          ).toBeVisible();
        }
      };
      await Promise.all([actions(), wait((scene.audioSeconds + 1) * 1000)]);
      timeline[timeline.length - 1].duration = (Date.now() - started) / 1000;
      await page.screenshot({ path: resolve(output, scene.id + '.png') });
      console.log('Recorded', scene.id, Math.round(timeline[timeline.length - 1].duration) + 's');
    }
    const record = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('sahayak.demo.presentation.v1')!),
    );
    expect(record.cursor).toBe(17);
    expect(record.data.feedback.work_status).toBe('assigned');
    expect(record.data.appointment.status).toBe('completed');
    writeFileSync(resolve(output, 'timeline.json'), JSON.stringify(timeline, null, 2));
    const video = page.video()!;
    await context.close();
    await video.saveAs(resolve(output, 'doctor-demo-raw.webm'));
  } finally {
    await context.close();
  }
});
