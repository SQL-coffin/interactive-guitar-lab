import { analyzeChromaProgression, buildChordSheet } from "@interactive-guitar-lab/audio-analysis";
import type { AudioAnalysisResponse } from "@/services";

const chroma = (pcs: number[]) => Array.from({ length: 12 }, (_, pc) => (pcs.includes(pc) ? 1 : 0));
const C = chroma([0, 4, 7]);
const G = chroma([7, 11, 2]);
const SILENT = chroma([]);

/** Real backend (analyzeChromaProgression) output for C, C, silence, C, G, G (one-second windows). */
export function analysisFixture(): AudioAnalysisResponse {
  const frames = [C, C, SILENT, C, G, G].map((values, i) => ({ startSeconds: i, endSeconds: i + 1, chroma: values, bassPitchClass: null }));
  const audio = { schemaVersion: "1.0" as const, filename: "take.wav", durationSeconds: 6, sampleRate: 22050, windowSeconds: 1, windowingMode: "fixed-window" as const, rhythm: { tempoBpm: 90, beatTimesSeconds: [0.5, 1.2], timeSignatureNumerator: null, timeSignatureDenominator: null, meterConfidence: null, barDurationSeconds: null, downbeatTimesSeconds: [] } };
  const chordAnalysis = analyzeChromaProgression(frames, { chordQualities: ["major", "minor"], progressionOptions: { limit: 2 } });
  return {
    audio,
    chordAnalysis,
    chordSheet: buildChordSheet(chordAnalysis.frameResults, {
      beatTimesSeconds: audio.rhythm.beatTimesSeconds,
      tempoBpm: audio.rhythm.tempoBpm,
    }),
  };
}
