"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ServiceError,
  isAbortError,
  type AudioAnalysisResponse,
  type ChromaProgressionAnalysisOptions,
  type GuitarLabService,
} from "@/services";

/** Mirrors the server's limit so users learn before uploading; the server still enforces it. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export type AudioAnalysisState =
  | { status: "idle" }
  | { status: "uploading"; fileName: string; loaded: number; total: number | null }
  | { status: "analyzing"; fileName: string }
  | { status: "success"; fileName: string; result: AudioAnalysisResponse }
  | { status: "error"; fileName: string | null; error: ServiceError };

export function validateAudioFile(file: File): ServiceError | null {
  if (file.size === 0) return new ServiceError("invalid_request", "This file is empty.");
  if (file.size > MAX_AUDIO_BYTES) return new ServiceError("invalid_request", "Audio files must be 25 MiB or smaller.", 413);
  return null;
}

/** Drives POST /api/audio-analysis with upload progress and cancellation. */
export function useAudioAnalysis(service: GuitarLabService) {
  const [state, setState] = useState<AudioAnalysisState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const analyze = useCallback(
    async (file: File, windowSeconds: number, options: ChromaProgressionAnalysisOptions): Promise<AudioAnalysisResponse | undefined> => {
      const invalid = validateAudioFile(file);
      if (invalid) {
        setState({ status: "error", fileName: file.name, error: invalid });
        return undefined;
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ status: "uploading", fileName: file.name, loaded: 0, total: file.size });
      try {
        const result = await service.analyzeAudio(
          { file, windowSeconds, options },
          {
            signal: controller.signal,
            onUploadProgress: ({ loaded, total }) => {
              if (controller.signal.aborted) return;
              setState(
                total !== null && loaded >= total
                  ? { status: "analyzing", fileName: file.name }
                  : { status: "uploading", fileName: file.name, loaded, total },
              );
            },
          },
        );
        if (controller.signal.aborted) return undefined;
        setState({ status: "success", fileName: file.name, result });
        return result;
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return undefined;
        setState({
          status: "error",
          fileName: file.name,
          error: error instanceof ServiceError
            ? error
            : new ServiceError("internal_error", error instanceof Error ? error.message : "Unexpected error."),
        });
        return undefined;
      }
    },
    [service],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setState({ status: "idle" });
  }, []);

  return { state, analyze, cancel };
}
