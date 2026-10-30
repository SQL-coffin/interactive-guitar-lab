import { analyzeChromaProgression, type ChromaProgressionAnalysisOptions, type ChromaProgressionAnalysisResult } from "./recommend-voicings.js";
import { buildChordSheet, type ChordSheetResult } from "./chord-sheet.js";
import { extractAudioFeatures, type AudioFeatureResponse, type AudioWorkerClientOptions } from "./worker-client.js";
import { analyzeKeyCandidates, type KeyAnalysisResult } from "./key-analysis.js";

export interface AnalyzeAudioForChordsOptions extends AudioWorkerClientOptions {
  chordAnalysis?: ChromaProgressionAnalysisOptions;
}

export interface AnalyzeAudioForChordsResult {
  audio: Omit<AudioFeatureResponse, "frames">;
  chordAnalysis: ChromaProgressionAnalysisResult;
  /** Conservative, editable chord-event timeline derived from the raw frame hypotheses. */
  chordSheet: ChordSheetResult;
  /** Optional so previously saved analysis sessions without this field remain readable. */
  keyAnalysis?: KeyAnalysisResult;
}

/**
 * End-to-end backend entry point: audio bytes -> Python chroma features -> chord hypotheses
 * -> candidate voicings -> globally ranked fingering paths.
 */
export async function analyzeAudioForChords(
  audio: Blob,
  options: AnalyzeAudioForChordsOptions,
): Promise<AnalyzeAudioForChordsResult> {
  const features = await extractAudioFeatures(audio, options);
  const chordAnalysis = analyzeChromaProgression(features.frames, options.chordAnalysis);
  const keyAnalysis = analyzeKeyCandidates(features.frames);
  const meterKnown = features.rhythm.timeSignatureNumerator != null
    && features.rhythm.timeSignatureDenominator === 4;
  const chordSheet = buildChordSheet(chordAnalysis.frameResults, {
    beatTimesSeconds: features.rhythm.beatTimesSeconds,
    tempoBpm: features.rhythm.tempoBpm,
    // The audio-analysis path must not silently assume 4/4 when meter is unknown.
    beatsPerBar: meterKnown ? features.rhythm.timeSignatureNumerator! : null,
    timeSignatureNumerator: features.rhythm.timeSignatureNumerator ?? null,
    timeSignatureDenominator: features.rhythm.timeSignatureDenominator ?? null,
    meterConfidence: features.rhythm.meterConfidence ?? null,
    barDurationSeconds: features.rhythm.barDurationSeconds ?? null,
    downbeatTimesSeconds: features.rhythm.downbeatTimesSeconds ?? [],
  });
  const { frames: _frames, ...metadata } = features;
  return { audio: metadata, chordAnalysis, chordSheet, keyAnalysis };
}
