// Analysis-session persistence and the analysis → progression workflow in a real browser
// (real IndexedDB, real reloads) against the running stack.
//   node e2e/session-workflows.cjs <reference.wav> [http://localhost:3000]
// Requires Playwright (not a project dependency) and a running audio worker.
const { chromium } = require('playwright');
const WAV = process.argv[2]; const BASE = process.argv[3] || 'http://localhost:3000';
if (!WAV) { console.error('usage: node e2e/session-workflows.cjs <reference.wav> [baseUrl]'); process.exit(2); }
const results = []; const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
const shows = (l, t = 10000) => l.first().waitFor({ timeout: t }).then(() => true, () => false);

(async () => {
  const browser = await browser_();
  async function browser_() { return chromium.launch(); }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  let analyses = 0; page.on('request', (r) => { if (r.url().includes('/api/audio-analysis')) analyses++; });
  const optimizeBodies = []; page.on('request', (r) => { if (r.url().endsWith('/api/progressions/optimize')) optimizeBodies.push(JSON.parse(r.postData())); });

  // ---- Analyze once
  await page.goto(BASE + '/audio');
  await page.setInputFiles('input[type=file]', WAV);
  const analysisResponse = page.waitForResponse((r) => r.url().includes('/api/audio-analysis'));
  await page.getByRole('button', { name: 'Analyze recording' }).click();
  const raw = await (await analysisResponse).json();
  await page.getByText('Tempo (estimate)').waitFor({ timeout: 60000 });
  const stored = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('guitar-theory-lab'); req.onsuccess = () => {
      const tx = req.result.transaction(['sessions'], 'readonly'); const all = tx.objectStore('sessions').getAll();
      all.onsuccess = () => resolve(all.result.map((s) => ({ id: s.id, file: s.source.filename, frames: s.result.chordAnalysis.frameResults.length, hasAudio: 'audio' in s && s.audio instanceof Blob })));
    };
  }));
  ok('session stored in IndexedDB with the raw result and no audio blob', stored.length === 1 && stored[0].frames === raw.chordAnalysis.frameResults.length && !stored[0].hasAudio, JSON.stringify(stored));
  const ls = await page.evaluate(() => Object.keys(localStorage).map((k) => [k, localStorage.getItem(k).length]));
  ok('localStorage holds only small ids', ls.every(([, n]) => n < 100), JSON.stringify(ls));

  // ---- Reload: restored from IndexedDB, no new analysis
  const before = analyses;
  await page.reload();
  ok('after reload the analysis is restored', await shows(page.getByText('Tempo (estimate)')));
  ok('reload did not re-run the analysis', analyses === before, `requests ${before} → ${analyses}`);
  const segs = await page.getByRole('toolbar', { name: 'Top hypothesis per window' }).getByRole('button').count();
  ok('restored timeline matches the stored response', segs === raw.chordAnalysis.frameResults.length, `${segs} windows`);
  ok('playback is honestly unavailable until audio is re-attached', await page.getByText(/Audio isn.t stored with saved analyses/).isVisible());
  await page.locator('label', { hasText: /^Attach / }).locator('input[type=file]').setInputFiles(WAV);
  ok('re-attached audio enables playback without re-analysis', (await shows(page.locator('audio'))) && analyses === before);

  // ---- Create a progression from the analysis
  await page.getByRole('button', { name: 'Create progression from path 1' }).click();
  const chips = page.getByRole('list', { name: 'Chords in the active progression' }).getByRole('button');
  const chipLabels = await chips.evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
  const path = raw.chordAnalysis.optimization.results[0];
  ok('progression keeps the path chord order', chipLabels.length > 0 && chipLabels.every((l, i) => l.startsWith(`Chord ${i + 1}:`)), chipLabels.slice(0, 4).join(' | '));
  const firstStepSymbol = path.steps[0].chordSymbol.replace(/#/g, '♯');
  ok('first chord and timestamp come from the response', chipLabels[0].includes(firstStepSymbol) && chipLabels[0].includes('0:00.0'), chipLabels[0]);
  await chips.nth(2).click();
  ok('selecting a chord jumps to its window', await shows(page.getByRole('region', { name: /^Window \d+/ })));
  ok('header shows the active session and unsaved progression', /ANALYSIS.*PROGRESSION.*unsaved/is.test(await page.getByLabel('Active work').innerText()));

  // ---- Builder: detected vs corrected, save, reload
  await page.getByRole('link', { name: 'Open in Progression Builder' }).click();
  const slots = page.locator('ol[aria-label="Chords in progression"] > li');
  await slots.first().waitFor();
  const n = await slots.count();
  ok('builder shows every extracted chord as detected', n === chipLabels.length && (await page.locator('li[data-origin="detected"]').count()) === n, `${n} chords`);
  const detected2 = (await slots.nth(1).getAttribute('aria-label')).split(': ')[1].split(',')[0];
  await slots.nth(1).getByLabel('Chord 2 Root').selectOption('D#');
  await slots.nth(1).getByLabel('Chord 2 Quality').selectOption('minor7');
  ok('correction is marked as edited and keeps the detected chord', await shows(page.getByText(`Edited · detected ${detected2.replace('#', '♯')}`)), detected2);
  // A real reload with unsaved edits triggers the browser's leave-page prompt.
  let prompted = false;
  page.once('dialog', async (d) => { prompted = d.type() === 'beforeunload'; await d.dismiss(); });
  await page.reload().catch(() => {});
  await page.waitForTimeout(500);
  ok('unsaved edits trigger a leave-page warning', prompted);
  await page.getByRole('button', { name: 'Save progression' }).click();
  ok('save clears the unsaved state', await shows(page.getByText(/^Saved /)));
  await page.reload();
  await slots.first().waitFor();
  ok('saved progression is restored after reload', (await slots.count()) === n && await page.getByText(/^Saved /).isVisible());
  ok('correction survives reload', await shows(page.getByRole('listitem', { name: `Chord 2 of ${n}: D#m7, corrected (detected ${detected2})` })));
  const rawAfter = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('guitar-theory-lab'); req.onsuccess = () => {
      const g = req.result.transaction('sessions').objectStore('sessions').getAll(); g.onsuccess = () => resolve(JSON.stringify(g.result[0].result));
    };
  }));
  ok('raw analysis in storage is unchanged by the correction', rawAfter === JSON.stringify(raw));

  // ---- Optimizer on the analysis progression (segmented if long)
  const optReq = page.waitForResponse((r) => r.url().endsWith('/api/progressions/optimize'));
  await page.getByRole('button', { name: /Find voicing paths|Recompute paths/ }).click();
  const optRes = await optReq;
  ok('voicing paths for the progression come from /api/progressions/optimize', optRes.status() === 200 && optimizeBodies.at(-1).layers.length === Math.min(n, 12), `HTTP ${optRes.status()}, layers ${optimizeBodies.at(-1).layers.length}`);

  // ---- Chord Explorer and back
  await slots.nth(1).getByRole('link', { name: 'Open in Chord Explorer' }).click();
  ok('Chord Explorer opens on the corrected chord', await shows(page.getByLabel('Chord D#m7')));
  ok('explorer shows the active progression is kept', await page.getByText(/Active progression .* is kept while you explore/).isVisible());
  await page.getByRole('link', { name: 'Back to the Progression Builder' }).click();
  await slots.first().waitFor();
  ok('progression intact after visiting the explorer', (await slots.count()) === n);
  await slots.nth(2).getByRole('button', { name: 'Show in analysis' }).click();
  ok('"Show in analysis" opens the source window', await shows(page.getByRole('region', { name: /^Window \d+/ })));
  ok('no further analysis requests during the workflow', analyses === before, `total ${analyses}`);
  ok('no page errors', errors.length === 0, errors.join('; '));

  console.log(results.map((r) => r.join('  ')).join('\n'));
  await browser.close();
  process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
})().catch((e) => { console.log(results.map((r) => r.join('  ')).join('\n')); console.error('ABORTED', e.message.split('\n')[0]); process.exit(1); });
