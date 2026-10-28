import type {
  ApiErrorBody,
  ChordQualitiesResponse,
  ChordResponse,
  FretboardResponse,
  VoicingSearchResponse,
} from "./contract";
import { ServiceError, isAbortError } from "./errors";
import type { GuitarLabService } from "./guitarLabService";

type FetchLike = typeof fetch;

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return typeof error === "object" && error !== null
    && typeof (error as { message?: unknown }).message === "string";
}

/** Talks to the HTTP API described in docs/frontend-api-contract.md. */
export function createHttpGuitarLabService(baseUrl: string, fetchImpl: FetchLike = fetch): GuitarLabService {
  const base = baseUrl.replace(/\/+$/, "");

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ServiceError("network_error", "Could not reach the Guitar Lab API.");
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      if (isApiErrorBody(body)) throw new ServiceError(body.error.code, body.error.message, response.status);
      throw new ServiceError(
        response.status === 404 ? "not_found" : "internal_error",
        `Request failed with status ${response.status}.`,
        response.status,
      );
    }
    return body as T;
  }

  const get = <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, signal ? { method: "GET", signal } : { method: "GET" });

  return {
    async listChordQualities(options) {
      const body = await get<ChordQualitiesResponse>("/chords/qualities", options?.signal);
      return body.qualities;
    },
    getChord({ root, quality }, options) {
      const query = new URLSearchParams({ root, quality });
      return get<ChordResponse>(`/chords?${query}`, options?.signal);
    },
    searchVoicings(body, options) {
      const init: RequestInit = { method: "POST", body: JSON.stringify(body) };
      if (options?.signal) init.signal = options.signal;
      return request<VoicingSearchResponse>("/voicings/search", init);
    },
    getFretboard({ maxFret, tuning }, options) {
      const query = new URLSearchParams({ maxFret: String(maxFret) });
      if (tuning) query.set("tuning", tuning.join(","));
      return get<FretboardResponse>(`/fretboard?${query}`, options?.signal);
    },
  };
}
