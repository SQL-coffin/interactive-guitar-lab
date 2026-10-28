// Posts each synthesized progression to the real POST /api/audio-analysis (Next route →
// Python worker → TypeScript inference/optimizer) and prints expected vs observed chords.
//   node e2e/audio-accuracy.mjs e2e/fixtures/out [http://localhost:3000] [--json out.json]
// Set CHORD_CONFIDENCE_WEIGHT to compare optimizer weights (the API default is 20).
// Exit code is 0 unless the service itself fails: accuracy misses are reported, not fatal.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [dir = "e2e/fixtures/out", base = "http://localhost:3000", ...rest] = process.argv.slice(2);
const jsonOut = rest[0] === "--json" ? rest[1] : undefined;
const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
const report = [];
let serviceFailures = 0;

for (const [name, entry] of Object.entries(manifest)) {
  const form = new FormData();
  form.append("file", new Blob([await readFile(join(dir, entry.file))], { type: "audio/wav" }), entry.file);
  form.append("windowSeconds", "1");
  form.append("options", JSON.stringify({ chordCandidateLimit: 3, voicingsPerChord: 5, voicingSearchOptions: { maxFret: 12, maxFretSpan: 4, minNotes: 4 }, progressionOptions: { limit: 1, ...(process.env.CHORD_CONFIDENCE_WEIGHT ? { chordConfidenceWeight: Number(process.env.CHORD_CONFIDENCE_WEIGHT) } : {}) } }));
  const response = await fetch(`${base}/api/audio-analysis`, { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok) {
    serviceFailures++;
    console.log(`${name}: HTTP ${response.status} ${JSON.stringify(body.error)}`);
    continue;
  }
  const { frameResults, progressionFrameIndexes, optimization } = body.chordAnalysis;
  const steps = optimization?.results[0]?.steps ?? [];
  const windows = frameResults.map((frame, i) => {
    const expected = entry.expected[Math.floor(frame.startSeconds / entry.chordSeconds)] ?? null;
    const top = frame.candidates[0];
    const stepIndex = progressionFrameIndexes.indexOf(i);
    const expectedCandidate = frame.candidates.find((c) => c.symbol === expected);
    return {
      window: i + 1,
      expected,
      top: top?.symbol ?? null,
      topScore: top ? Number(top.score.toFixed(3)) : null,
      expectedRank: expectedCandidate ? frame.candidates.indexOf(expectedCandidate) + 1 : null,
      expectedScore: expectedCandidate ? Number(expectedCandidate.score.toFixed(3)) : null,
      bassRootMatch: expectedCandidate?.evidence.bassRootMatch ?? null,
      path: stepIndex >= 0 ? steps[stepIndex]?.chordSymbol ?? null : null,
    };
  });
  const topHits = windows.filter((w) => w.top === w.expected).length;
  const pathHits = windows.filter((w) => w.path === w.expected).length;
  report.push({ name, tempoBpm: body.audio.rhythm.tempoBpm, beats: body.audio.rhythm.beatTimesSeconds.length, topHits, pathHits, windows: windows.length, detail: windows });
  console.log(`\n${name}: top hypothesis ${topHits}/${windows.length}, optimizer path ${pathHits}/${windows.length}, tempo ${body.audio.rhythm.tempoBpm ?? "none"}`);
  for (const w of windows) {
    const flag = w.top === w.expected && w.path === w.expected ? "  " : w.top === w.expected ? "P " : "T ";
    console.log(`  ${flag}w${w.window} expected ${String(w.expected).padEnd(6)} top ${String(w.top).padEnd(6)} (${w.topScore}) expected-rank ${w.expectedRank ?? "-"} (${w.expectedScore ?? "-"}) bass-match ${w.bassRootMatch} path ${w.path}`);
  }
}
if (jsonOut) await writeFile(jsonOut, JSON.stringify(report, null, 2));
console.log(`\nLegend: T = top hypothesis differs from expected, P = only the optimizer path differs.`);
process.exit(serviceFailures ? 1 : 0);
