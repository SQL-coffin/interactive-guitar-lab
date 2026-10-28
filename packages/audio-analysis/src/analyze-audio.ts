import { analyzeChromaProgression, type ChromaProgressionAnalysisOptions, type ChromaProgressionAnalysisResult } from "./recommend-voicings.js";
import { buildChordSheet, type ChordSheetResult } from "./chord-sheet.js";
import { extractAudioFeatures, type AudioFeatureResponse, type AudioWorkerClientOptions } from "./worker-client.js";

export interface AnalyzeAudioForChordsOptions extends AudioWorkerClientOptions {
  chordAnalysis?: ChromaProgressionAnalysisOptions;
}

export interface AnalyzeAudioForChordsResult {
  audio: Omit<AudioFeatureResponse, "frames">;
  chordAnalysis: ChromaProgressionAnalysisResult;
  /** Conservative, editable chord-event timeline derived from the raw frame hypotheses. */
  chordSheet: ChordSheetResult;
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
  const chordSheet = buildChordSheet(chordAnalysis.frameResults, {
    beatTimesSeconds: features.rhythm.beatTimesSeconds,
    tempoBpm: features.rhythm.tempoBpm,
  });
  const { frames: _frames, ...metadata } = features;
  return { audio: metadata, chordAnalysis, chordSheet };
}
