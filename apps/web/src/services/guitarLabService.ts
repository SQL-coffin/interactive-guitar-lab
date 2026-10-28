import type {
  ChordQuality,
  ChordRequest,
  ChordResponse,
  FretboardRequest,
  FretboardResponse,
  VoicingSearchRequest,
  VoicingSearchResponse,
} from "./contract";

export interface RequestOptions {
  signal?: AbortSignal;
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
}
