import type {
  AudioAnalysisRequest,
  AudioAnalysisResponse,
  ChordQuality,
  ChordRequest,
  ChordResponse,
  FretboardRequest,
  FretboardResponse,
  ProgressionOptimizationRequest,
  ProgressionOptimizationResult,
  VoicingSearchRequest,
  VoicingSearchResponse,
} from "./contract";

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface UploadProgress {
  loaded: number;
  /** Null when the browser cannot determine the request size. */
  total: number | null;
}

export interface UploadRequestOptions extends RequestOptions {
  onUploadProgress?: (progress: UploadProgress) => void;
}

/**
 * Everything the UI needs from the music-theory backend. Components depend on this
 * interface only; they never call the engine directly.
 */
export interface GuitarLabService {
  listChordQualities(options?: RequestOptions): Promise<ChordQuality[]>;
  getChord(request: ChordRequest, options?: RequestOptions): Promise<ChordResponse>;
  searchVoicings(request: VoicingSearchRequest, options?: RequestOptions): Promise<VoicingSearchResponse>;
  getFretboard(request: FretboardRequest, options?: RequestOptions): Promise<FretboardResponse>;
  analyzeAudio(request: AudioAnalysisRequest, options?: UploadRequestOptions): Promise<AudioAnalysisResponse>;
  optimizeProgression(request: ProgressionOptimizationRequest, options?: RequestOptions): Promise<ProgressionOptimizationResult>;
}
