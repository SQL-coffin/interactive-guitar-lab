"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ServiceError, isAbortError } from "@/services";

export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading"; previous: T | undefined }
  | { status: "success"; data: T }
  | { status: "error"; error: ServiceError };

/**
 * Loads data whenever `key` changes. In-flight requests for a stale key are aborted, so a
 * slow response can never overwrite a newer one. Pass `key = null` to stay idle.
 */
export function useAsyncResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): AsyncState<T> & { retry: () => void } {
  const [state, setState] = useState<AsyncState<T>>(key === null ? { status: "idle" } : { status: "loading", previous: undefined });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (key === null) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState((current) => ({
      status: "loading",
      previous: current.status === "success" ? current.data : current.status === "loading" ? current.previous : undefined,
    }));
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: "success", data });
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        const serviceError = error instanceof ServiceError
          ? error
          : new ServiceError("internal_error", error instanceof Error ? error.message : "Unexpected error.");
        setState({ status: "error", error: serviceError });
      },
    );
    return () => controller.abort();
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
