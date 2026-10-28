"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ServiceError,
  isAbortError,
  type BuiltChord,
  type GuitarLabService,
  type ProgressionOptimizationResult,
} from "@/services";
import { candidatesPerChord, type ProgressionSettings, type ProgressionSlot } from "./progressionState";

export interface ProgressionRun {
  /** Request key the result was computed for. */
  key: string;
  /** Snapshot of the chords in the order they were optimized. */
  slots: ProgressionSlot[];
  chords: BuiltChord[];
  result: ProgressionOptimizationResult;
}

export type OptimizerState =
  | { status: "idle" }
  | { status: "loading"; phase: "searching" | "optimizing"; previous: ProgressionRun | undefined }
  | { status: "success"; run: ProgressionRun }
  | { status: "empty"; emptyChords: string[] }
  | { status: "error"; error: ServiceError };

/**
 * Orchestrates the two backend steps: POST /api/voicings/search for each chord, then the
 * engine's progression optimizer over those candidates. No scoring happens in the UI.
 */
export function useProgressionOptimizer(service: GuitarLabService) {
  const [state, setState] = useState<OptimizerState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(
    async (slots: ProgressionSlot[], settings: ProgressionSettings, key: string) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const { signal } = controller;
      setState((current) => ({
        status: "loading",
        phase: "searching",
        previous: current.status === "success" ? current.run : current.status === "loading" ? current.previous : undefined,
      }));

      const perChord = candidatesPerChord(settings.voicingsPerChord, slots.length);
      try {
        const searches = await Promise.all(
          slots.map((slot) =>
            service.searchVoicings(
              {
                root: slot.root,
                quality: slot.quality,
                options: {
                  maxFret: settings.maxFret,
                  maxFretSpan: settings.maxFretSpan,
                  minNotes: settings.minNotes,
                  limit: perChord,
                },
              },
              { signal },
            ),
          ),
        );
        if (signal.aborted) return;
        const emptyChords = searches.filter((s) => s.results.length === 0).map((s) => s.chord.symbol);
        if (emptyChords.length > 0) {
          setState({ status: "empty", emptyChords });
          return;
        }
        setState((current) => (current.status === "loading" ? { ...current, phase: "optimizing" } : current));
        const result = await service.optimizeProgression(
          { layers: searches.map((s) => s.results), options: { limit: settings.pathLimit } },
          { signal },
        );
        if (signal.aborted) return;
        if (result.results.length === 0) {
          setState({ status: "empty", emptyChords: [] });
          return;
        }
        setState({ status: "success", run: { key, slots, chords: searches.map((s) => s.chord), result } });
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        setState({
          status: "error",
          error: error instanceof ServiceError
            ? error
            : new ServiceError("internal_error", error instanceof Error ? error.message : "Unexpected error."),
        });
      }
    },
    [service],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setState((current) => (current.status === "loading" && current.previous ? { status: "success", run: current.previous } : { status: "idle" }));
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState({ status: "idle" });
  }, []);

  return { state, run, cancel, reset };
}
