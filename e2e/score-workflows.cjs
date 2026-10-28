// Jianpu score view in a real browser against the running stack: meter display, bars from the
// detected downbeats (or the time-based fallback), no invented melody, melody edit → save → reload.
//   node e2e/score-workflows.cjs <recording.wav> [http://localhost:3000]
// Requires Playwright (not a project dependency) and a running audio worker.
const { chromium } = require('playwright');
const WAV = process.argv[2]; const BASE = process.argv[3] || 'http://localhost:3000';
if (!WAV) { console.error('usage: node e2e/score-workflows.cjs <recording.wav> [baseUrl]'); process.exit(2); }
const results = []; const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
const BAR = /^(Bar \d+|Pickup),/;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  let analyses = 0; page.on('request', (r) => { if (r.url().includes('/api/audio-analysis')) analyses++; });

  await page.goto(BASE + '/audio');
  await page.setInputFiles('input[type=file]', WAV);
  const response = page.waitForResponse((r) => r.url().includes('/api/audio-analysis'));
  await page.getByRole('button', { name: 'Analyze recording' }).click();
  const raw = await (await response).json();
  await page.getByText('Tempo (estimate)').waitFor({ timeout: 60000 });
  const rh = raw.audio.rhythm;
  const known = rh.timeSignatureNumerator != null && rh.timeSignatureDenominator != null && (rh.downbeatTimesSeconds ?? []).length > 0;
  const signature = known ? `${rh.timeSignatureNumerator}/${rh.timeSignatureDenominator}` : 'Unknown';

  await page.getByRole('radio', { name: 'Score · 简谱' }).click();
  const score = page.getByRole('region', { name: 'Score · 简谱' });
  await score.getByText('Time signature', { exact: true }).waitFor();
  ok('time signature comes from the response', (await score.getByText('Time signature', { exact: true }).locator('xpath=..').innerText()).includes(signature), signature);
  ok('melody is not invented from the chord analysis', (await score.locator('.jianpu-note').count()) === 0 && await score.getByText(/Melody: not transcribed/).isVisible());

  if (!known) {
    ok('unknown meter falls back to a time-based view', await score.getByLabel('Chord timeline (time signature unknown)').isVisible());
    ok('no bars are drawn without a meter', (await score.getByRole('group', { name: BAR }).count()) === 0);
  } else {
    const bars = await score.getByRole('group', { name: BAR }).evaluateAll((g) => g.map((x) => x.getAttribute('aria-label')));
    const numbered = bars.filter((l) => l.startsWith('Bar ')).length;
    ok('one bar per detected downbeat', numbered === rh.downbeatTimesSeconds.length, `${bars.length} bars, ${rh.downbeatTimesSeconds.length} downbeats`);
    ok('score heading shows key, meter and tempo', await score.getByText(new RegExp(`^1 = \\? · ${signature} · ♩`)).isVisible());
    const first = rh.beatTimesSeconds[0] ?? 0;
    if (first > 0.25) ok('audio before the first beat is flagged', await score.getByText(/before the first detected beat/).isVisible(), `${first.toFixed(2)} s`);

    await score.getByRole('button', { name: /melody slot$/ }).first().click();
    for (const d of ['5', '5', '6', '5']) await score.getByRole('button', { name: `Degree ${d}` }).click();
    ok('entered notes appear in the melody lane', (await score.locator('.jianpu-note').count()) === 4);
    await score.getByRole('button', { name: 'Save score' }).click();
    ok('save confirms', await score.getByText(/^Saved /).waitFor().then(() => true, () => false));
    const before = analyses;
    await page.reload(); await page.getByText('Tempo (estimate)').waitFor();
    await page.getByRole('radio', { name: 'Score · 简谱' }).click();
    const restored = page.getByRole('region', { name: 'Score · 简谱' });
    await restored.getByText('Time signature', { exact: true }).waitFor();
    ok('melody is restored after reload without re-analysis', (await restored.locator('.jianpu-note').count()) === 4 && analyses === before);
  }

  const stored = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('guitar-theory-lab'); req.onsuccess = () => {
      const all = req.result.transaction(['sessions'], 'readonly').objectStore('sessions').getAll();
      all.onsuccess = () => resolve(all.result[0]?.result.chordSheet);
    };
  }));
  ok('raw chord sheet in storage is unchanged', JSON.stringify(stored) === JSON.stringify(raw.chordSheet));

  const mobile = await ctx.newPage(); await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE + '/audio'); await mobile.getByText('Tempo (estimate)').waitFor();
  await mobile.getByRole('radio', { name: 'Score · 简谱' }).click();
  ok('no horizontal page overflow on mobile', (await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? `  ${d}` : ''}`);
  process.exit(results.some(([s]) => s === 'FAIL') ? 1 : 0);
})();
