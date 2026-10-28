import {
  STANDARD_GUITAR_TUNING,
  buildChord,
  getFretboard,
  getSupportedChordQualities,
  searchVoicings,
} from "@interactive-guitar-lab/music-theory";
import { toServiceError } from "./errors";
import type { GuitarLabService, RequestOptions } from "./guitarLabService";

/**
 * Temporary adapter used until the HTTP API exists: it delegates to the shared engine
 * in-process and reproduces the HTTP contract's async/error semantics, so swapping in
 * the HTTP adapter requires no UI changes. It contains no theory logic of its own.
 */
export function createLocalGuitarLabService(): GuitarLabService {
  async function run<T>(options: RequestOptions | undefined, compute: () => T): Promise<T> {
    // Yield first so callers observe a genuine async boundary, as they would over HTTP.
    await Promise.resolve();
    options?.signal?.throwIfAborted();
    try {
      return compute();
    } catch (error) {
      throw toServiceError(error);
    }
  }

  return {
    listChordQualities: (options) => run(options, () => getSupportedChordQualities()),
    getChord: ({ root, quality }, options) => run(options, () => buildChord(root, quality)),
    searchVoicings: ({ root, quality, options: searchOptions }, options) =>
      run(options, () => searchVoicings(root, quality, searchOptions)),
    getFretboard: ({ maxFret, tuning }, options) =>
      run(options, () => {
        const resolvedTuning = [...(tuning ?? STANDARD_GUITAR_TUNING)];
        return { tuning: resolvedTuning, maxFret, positions: getFretboard({ tuning: resolvedTuning, maxFret }) };
      }),
  };
}
