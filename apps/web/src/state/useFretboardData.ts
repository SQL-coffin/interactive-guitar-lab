"use client";

import { useMemo } from "react";
import type { FretboardResponse } from "@/services";
import { useGuitarLabService } from "./ServiceContext";
import { useAsyncResource } from "./useAsyncResource";

/** Frets drawn on the interactive board (independent of any voicing search range). */
export const FRETBOARD_FRETS = 15;
const FALLBACK_STRING_COUNT = 6;

/**
 * Loads the fretboard once per page from GET /api/fretboard. String count follows the tuning
 * the backend returns, so a seven-string tuning renders without UI changes.
 */
export function useFretboardData(maxFret: number = FRETBOARD_FRETS) {
  const service = useGuitarLabService();
  const fretboard = useAsyncResource<FretboardResponse>(`fretboard:${maxFret}`, (signal) =>
    service.getFretboard({ maxFret }, { signal }),
  );
  const openStringNames = useMemo(
    () => new Map(fretboard.status === "success"
      ? fretboard.data.positions.filter((p) => p.fret === 0).map((p) => [p.string, p.noteName])
      : []),
    [fretboard],
  );
  const stringCount = fretboard.status === "success" ? fretboard.data.tuning.length : FALLBACK_STRING_COUNT;
  return { fretboard, openStringNames, stringCount };
}
