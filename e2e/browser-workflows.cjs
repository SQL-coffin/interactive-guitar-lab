// Drives the three workflows in a real browser against the running stack and checks that
// what the UI shows matches the actual API responses captured from the network.
//   node e2e/browser-workflows.cjs <reference.wav> [http://localhost:3000] [screenshot-dir]
// Requires Playwright (not a project dependency) and a running audio worker.
// Steps marked "injected" stub one response via page.route to exercise empty/error states;
// everything else talks to the real routes.
const { chromium } = require('playwright');
const os = require('os'); const fs = require('fs'); const nodePath = require('path');
const WAV = process.argv[2]; const BASE = process.argv[3] || 'http://localhost:3000';
const S = process.argv[4] || fs.mkdtempSync(nodePath.join(os.tmpdir(), 'igl-e2e-'));
if (!WAV) { console.error('usage: node e2e/browser-workflows.cjs <reference.wav> [baseUrl] [screenshotDir]'); process.exit(2); }
const results = []; const ok = (name, cond, detail = '') => { results.push([cond ? 'PASS' : 'FAIL', name, detail]); };
// Playwright's isVisible() never waits; this does.
const shows = (locator, timeout = 10000) => locator.first().waitFor({ timeout }).then(() => true, () => false);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const calls = []; const errors = [];
  ctx.on('request', (r) => { if (r.url().includes('/api/')) calls.push({ m: r.method(), p: new URL(r.url()).pathname, body: r.postData() }); });
  const responses = [];
  ctx.on('response', async (r) => { if (r.url().includes('/api/') && r.request().method() !== 'OPTIONS') { try { responses.push({ p: new URL(r.url()).pathname + new URL(r.url()).search, s: r.status(), j: await r.json() }); } catch {} } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const last = (prefix) => [...responses].reverse().find((r) => r.p.startsWith(prefix));
  const waitResp = (prefix, method = 'GET') => page.waitForResponse((r) => new URL(r.url()).pathname.startsWith(prefix) && r.request().method() === method);

  // ---------- Workflow A: Chord explorer ----------
  await page.goto(BASE + '/');
  await page.waitForSelector('[aria-label^="Voicing 1:"]');
  for (const [root, quality, label] of [['D', 'minor7', 'Minor 7'], ['F♯', 'dominant7', 'Dominant 7'], ['B♭', 'sus4', 'Sus 4']]) {
    if (root === 'B♭') await page.getByRole('radio', { name: '♭' }).click();
    const chordResp = waitResp('/api/chords'); const vResp = waitResp('/api/voicings/search', 'POST');
    await page.getByRole('radio', { name: root, exact: true }).click();
    await page.getByRole('radio', { name: label }).click();
    const chord = await (await chordResp).json();
    // there can be two in-flight responses (root change, then quality change); wait for the final one
    await page.waitForTimeout(400);
    const finalChord = last('/api/chords?').j; const finalV = last('/api/voicings/search').j;
    const tones = await page.getByRole('table', { name: /Chord tones of/ }).locator('tbody tr').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent.trim())));
    const expected = finalChord.tones.map((t) => [t.degree, t.spelling.replace(/#/g, '♯').replace(/(?<=^[A-G])b/, '♭'), String(t.semitonesFromRoot)]);
    ok(`A: ${finalChord.symbol} tones match /api/chords`, JSON.stringify(tones) === JSON.stringify(expected), JSON.stringify(tones));
    const tab1 = await page.locator('[aria-label^="Voicing 1:"]').getAttribute('aria-label');
    const apiTab1 = finalV.results[0].strings.map((n) => (n === null ? 'x' : n.fret));
    const apiTabStr = apiTab1.some((f) => String(f).length > 1) ? apiTab1.join('-') : apiTab1.join('');
    ok(`A: ${finalChord.symbol} voicing #1 matches /api/voicings/search`, tab1 === `Voicing 1: ${apiTabStr}`, `${tab1} vs ${apiTabStr}`);
    const count = await page.getByText(/^Showing \d+ of \d+ voicing/).textContent();
    ok(`A: ${finalChord.symbol} count matches totalFound`, count.includes(`of ${finalV.totalFound} voicing`), count);
    // fretboard muted / open / root markers for voicing 1
    const v = finalV.results[0];
    const mutedStrings = v.strings.map((n, i) => (n === null ? i + 1 : null)).filter(Boolean);
    const breakdownMuted = await page.getByRole('table', { name: /String-by-string breakdown/ }).locator('tbody tr[data-muted="true"]').count();
    ok(`A: ${finalChord.symbol} muted strings in breakdown match voicing`, breakdownMuted === mutedStrings.length, `${breakdownMuted} vs ${mutedStrings.length}`);
    const inVoicing = await page.getByRole('button', { name: /in selected voicing/ }).count();
    ok(`A: ${finalChord.symbol} fretboard shows every sounding note`, inVoicing === v.notes.length, `${inVoicing} vs ${v.notes.length}`);
    const rootCells = await page.locator('[data-variant="voicing"][data-root="true"]').count();
    ok(`A: ${finalChord.symbol} root markers = notes with degree 1`, rootCells === v.notes.filter((n) => n.degree === '1').length);
  }
  // compare
  await page.getByRole('button', { name: /^Compare voicing 3 with/ }).click();
  const cmp = await page.getByRole('region', { name: /Change from voicing 1 to voicing 3/ }).count();
  ok('A: compare voicing 3 shows transition', cmp === 1);
  ok('A: compare shape drawn as dashed markers', (await page.locator('[data-variant="compare"], [data-shared="true"]').count()) > 0);
  await page.screenshot({ path: `${S}/p2-explorer.png` });

  // Injected: empty and malformed voicing responses (network stubs, real UI)
  await page.route('**/api/voicings/search', (route) => route.fulfill({ json: { chord: last('/api/voicings/search').j.chord, options: {}, results: [], totalFound: 0 } }));
  await page.getByRole('radio', { name: 'Major', exact: true }).click();
  ok('A: injected empty search → empty state', await shows(page.getByText(/No playable .* voicings match/)));
  await page.unroute('**/api/voicings/search');
  await page.route('**/api/voicings/search', (route) => route.fulfill({ json: { unexpected: true } }));
  await page.getByRole('radio', { name: 'Minor', exact: true }).click();
  const alert = page.locator('main').getByRole('alert').filter({ hasText: 'Voicing search failed' });
  ok('A: injected malformed response → error state', await shows(alert), await alert.textContent().catch(() => ''));
  await page.unroute('**/api/voicings/search');
  await alert.getByRole('button', { name: 'Try again' }).click();
  ok('A: retry after malformed response recovers', await shows(page.locator('[aria-label^="Voicing 1:"]')));

  // ---------- Workflow B: Progression builder ----------
  await page.getByRole('link', { name: 'Progressions' }).click();
  await page.getByRole('button', { name: /Start with C – G – Am – F/ }).click();
  await page.waitForSelector('text=Am');
  await page.getByLabel('New chord Root').selectOption('D');
  await page.getByLabel('New chord Quality').selectOption('minor7');
  await page.getByRole('button', { name: 'Add D chord' }).click();
  await page.getByText('Dm7').waitFor();
  await page.getByLabel('Chord 2 Quality').selectOption('dominant7');
  await page.getByText('G7').waitFor();
  await page.getByRole('button', { name: 'Move chord 5 earlier' }).click();
  await page.getByRole('button', { name: 'Remove chord 1' }).click();
  const slotLabels = await page.locator('ol[aria-label="Chords in progression"] > li').evaluateAll((ls) => ls.map((l) => l.getAttribute('aria-label').split(': ')[1]));
  ok('B: add/edit/reorder/remove → G7 Am Dm7 F', JSON.stringify(slotLabels) === JSON.stringify(['G7', 'Am', 'Dm7', 'F']), slotLabels.join(' '));
  const chordCallsBefore = calls.filter((c) => c.p === '/api/chords').length;
  ok('B: chord identities fetched from /api/chords', chordCallsBefore > 0);
  const before = calls.length;
  const optResp = waitResp('/api/progressions/optimize', 'POST');
  await page.getByRole('button', { name: 'Find voicing paths' }).click();
  const optimize = await optResp; const optJson = await optimize.json();
  const runCalls = calls.slice(before);
  const searches = runCalls.filter((c) => c.p === '/api/voicings/search');
  const opt = runCalls.find((c) => c.p === '/api/progressions/optimize');
  ok('B: one voicing search per chord', searches.length === 4, String(searches.length));
  const sent = JSON.parse(opt.body);
  ok('B: optimize request carries candidate layers from the searches', sent.layers.length === 4 && sent.layers.every((l) => l.length === 8), sent.layers.map((l) => l.length).join(','));
  ok('B: optimize request options', JSON.stringify(sent.options) === JSON.stringify({ limit: 3 }), JSON.stringify(sent.options));
  ok('B: optimize HTTP 200', optimize.status() === 200);
  await page.waitForSelector('[role=tab]');
  const tabs = await page.getByRole('tab').allTextContents();
  ok('B: path tabs match response totals', tabs.length === optJson.results.length && tabs.every((t, i) => t.includes(optJson.results[i].totalCost.toFixed(2))), tabs.join(' | '));
  const stepLabels = await page.getByRole('list', { name: 'Path 1 chord shapes' }).getByRole('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
  const expSteps = optJson.results[0].steps.map((s, i) => {
    const f = s.voicing.strings.map((n) => (n === null ? 'x' : n.fret)); const tab = f.some((x) => String(x).length > 1) ? f.join('-') : f.join('');
    return `Step ${i + 1}: ${s.chordSymbol}, ${tab}`;
  });
  ok('B: step chords + shapes match response', JSON.stringify(stepLabels) === JSON.stringify(expSteps), stepLabels.join(' | '));
  await page.getByRole('button', { name: /^Step 3:/ }).click();
  const costs = await page.locator('dl').filter({ hasText: 'Transition cost' }).first().textContent();
  ok('B: step 3 transition cost from response', costs.includes(optJson.results[0].steps[2].transitionCost.toFixed(2)), costs);
  await page.getByRole('tab', { name: /Path 2/ }).click();
  const step3p2 = await page.getByRole('heading', { name: /^Step 3:/ }).textContent();
  ok('B: path 2 selectable', step3p2.includes(optJson.results[1].steps[2].chordSymbol), step3p2);
  await page.getByLabel('Highest fret').selectOption('9');
  ok('B: stale flag after settings change', await page.getByText(/changed since these paths were computed/).isVisible());
  await page.screenshot({ path: `${S}/p2-progression.png`, fullPage: true });
  // Injected server failure
  await page.route('**/api/progressions/optimize', (route) => route.fulfill({ status: 500, json: { error: { code: 'internal_error', message: 'An unexpected server error occurred.' } } }));
  await page.getByRole('button', { name: 'Recompute paths' }).click();
  const pAlert = page.locator('main').getByRole('alert').filter({ hasText: "Couldn't compute voicing paths" });
  ok('B: injected 500 → error state with server message', await pAlert.waitFor({ timeout: 10000 }).then(() => true, () => false), await pAlert.textContent().catch(() => ''));
  ok('B: no stale paths shown alongside the error', (await page.getByRole('tab').count()) === 0);
  await page.unroute('**/api/progressions/optimize');
  await pAlert.getByRole('button', { name: 'Try again' }).click();
  await page.waitForSelector('[role=tab]', { timeout: 20000 });
  ok('B: retry recovers', (await page.getByRole('tab').count()) === 3);
  // Real bound: 12 chords x 20 candidates
  await page.getByRole('button', { name: 'Clear all' }).click();
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: /^Add .* chord$/ }).click();
  await page.getByLabel('Candidates per chord').selectOption('20');
  await page.getByLabel('Highest fret').selectOption('12');
  const bigResp = waitResp('/api/progressions/optimize', 'POST');
  await page.getByRole('button', { name: /Find voicing paths|Recompute paths/ }).click();
  const big = await bigResp;
  const bigBody = JSON.parse(calls.filter((c) => c.p === '/api/progressions/optimize').at(-1).body);
  ok('B: 12 chords x 20 candidates accepted by server', big.status() === 200, `HTTP ${big.status()} layers=${bigBody.layers.length} total=${bigBody.layers.flat().length}`);
  ok('B: clamp notice shown', await page.getByText(/accepts at most 16 candidates per chord/).isVisible());
  await page.waitForSelector('[role=tab]', { timeout: 30000 });
  ok('B: 12-chord paths rendered', (await page.getByRole('list', { name: 'Path 1 chord shapes' }).getByRole('button').count()) === 12);

  // ---------- Workflow C: Audio ----------
  await page.getByRole('link', { name: 'Audio analysis' }).click();
  await page.setInputFiles('input[type=file]', WAV);
  const aResp = waitResp('/api/audio-analysis', 'POST');
  await page.getByRole('button', { name: 'Analyze recording' }).click();
  const sawProgress = await shows(page.getByText(/Uploading progression.wav|Analyzing on the server/));
  ok('C: upload/analyzing state visible', sawProgress);
  const audio = await aResp; const aj = await audio.json();
  const areq = calls.filter((c) => c.p === '/api/audio-analysis').at(-1);
  ok('C: multipart upload reached /api/audio-analysis', audio.status() === 200 && areq !== undefined, `HTTP ${audio.status()}`);
  await page.getByText('Tempo (estimate)').waitFor();
  const overview = await page.locator('dl').first().textContent();
  ok('C: duration/tempo/beats rendered from response',
    overview.includes(aj.audio.rhythm.tempoBpm === null ? 'No stable estimate' : aj.audio.rhythm.tempoBpm.toFixed(1)) && overview.includes(`Beats detected${aj.audio.rhythm.beatTimesSeconds.length}`),
    overview);
  const segs = page.getByRole('toolbar', { name: 'Top hypothesis per window' }).getByRole('button');
  ok('C: one timeline segment per frame', (await segs.count()) === aj.chordAnalysis.frameResults.length);
  const path = aj.chordAnalysis.optimization.results[0];
  let consistent = true; const detail = [];
  for (const fi of [0, 3, 5, 7]) {
    await segs.nth(fi).click();
    const region = page.getByRole('region', { name: new RegExp(`^Window ${fi + 1}`) });
    const cands = await region.locator('ol').first().locator(':scope > li').evaluateAll((ls) => ls.map((l) => l.querySelector('span').textContent));
    const apiC = aj.chordAnalysis.frameResults[fi].candidates.map((c) => c.symbol.replace(/#/g, '♯'));
    const stepIdx = aj.chordAnalysis.progressionFrameIndexes.indexOf(fi);
    const chosen = await region.locator('li[data-chosen="true"] span').first().textContent().catch(() => null);
    const fits = await region.locator('ol li p').first().textContent();
    const good = JSON.stringify(cands) === JSON.stringify(apiC) && chosen === path.steps[stepIdx].chordSymbol.replace(/#/g, '♯')
      && fits.includes(aj.chordAnalysis.frameResults[fi].candidates[0].confidence.toFixed(2));
    consistent &&= good; detail.push(`w${fi + 1}: ${cands.join('/')} chosen=${chosen}`);
  }
  ok('C: window candidates + chosen chord match response', consistent, detail.join('; '));
  // Cancellation during server analysis
  const cancelReq = page.waitForRequest((r) => r.url().includes('/api/audio-analysis'));
  await page.getByRole('button', { name: 'Analyze again' }).click();
  await cancelReq;
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(2500);
  ok('C: cancel returns to idle without results', (await page.getByText('No analysis yet').isVisible()) && !(await page.getByText('Tempo (estimate)').isVisible()));
  // Undecodable upload: the worker must reject it and no previous result may remain visible.
  await page.getByRole('button', { name: 'Analyze recording' }).isDisabled();
  const junk = nodePath.join(S, 'not-audio.wav'); fs.writeFileSync(junk, 'definitely not audio\n');
  await page.setInputFiles('input[type=file]', junk);
  const badResp = waitResp('/api/audio-analysis', 'POST');
  await page.getByRole('button', { name: /Analyze (recording|again)/ }).click();
  const bad = await badResp;
  const badAlert = page.locator('main').getByRole('alert');
  await badAlert.waitFor();
  ok('C: undecodable file → HTTP 400 + error, no results', bad.status() === 400 && !(await page.getByText('Tempo (estimate)').isVisible()), await badAlert.innerText());
  await page.screenshot({ path: `${S}/p2-audio.png`, fullPage: true });
  await page.close();
  console.log(results.map((r) => r.join('  ')).join('\n'));
  console.log('api endpoints:', [...new Set(calls.map((c) => `${c.m} ${c.p}`))].join(', '));
  console.log('console/page errors (injected 500 and the undecodable upload log one each):', errors.length ? errors.slice(0, 5) : 'none');
  console.log('screenshots:', S);
  await browser.close();
  process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
})().catch((e) => { console.log(results.map((r) => r.join('  ')).join('\n')); console.error('ABORTED', e.message.split('\n')[0]); process.exit(1); });
