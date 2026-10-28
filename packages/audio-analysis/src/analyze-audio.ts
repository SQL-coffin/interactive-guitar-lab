import { analyzeChromaProgression, type ChromaProgressionAnalysisOptions, type ChromaProgressionAnalysisResult } from "./recommend-voicings.js";
import { extractAudioFeatures, type AudioFeatureResponse, type AudioWorkerClientOptions } from "./worker-client.js";

export interface AnalyzeAudioForChordsOptions extends AudioWorkerClientOptions {
  chordAnalysis?: ChromaProgressionAnalysisOptions;
}

export interface AnalyzeAudioForChordsResult {
  audio: Omit<AudioFeatureResponse, "frames">;
  chordAnalysis: ChromaProgressionAnalysisResult;
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
  const { frames: _frames, ...metadata } = features;
  return { audio: metadata, chordAnalysis };
}
