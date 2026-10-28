import type {
  ApiErrorBody,
  AudioAnalysisRequest,
  AudioAnalysisResponse,
  ChordResponse,
  FretboardResponse,
  VoicingSearchResponse,
} from "./contract";
import { ServiceError, isAbortError } from "./errors";
import type { GuitarLabService, UploadRequestOptions } from "./guitarLabService";
import {
  isAudioAnalysisResponse,
  isChordQualitiesResponse,
  isChordResponse,
  isFretboardResponse,
  isProgressionOptimizationResponse,
  isVoicingSearchResponse,
} from "./responseGuards";

type FetchLike = typeof fetch;
type XhrFactory = () => XMLHttpRequest;

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return typeof error === "object" && error !== null
    && typeof (error as { message?: unknown }).message === "string";
}

function errorFromStatus(status: number, body: unknown): ServiceError {
  if (isApiErrorBody(body)) return new ServiceError(body.error.code, body.error.message, status);
  return new ServiceError(
    status === 404 ? "not_found" : "internal_error",
    `Request failed with status ${status}.`,
    status,
  );
}

function expectShape<T>(body: unknown, guard: (value: unknown) => value is T, what: string): T {
  if (!guard(body)) throw new ServiceError("internal_error", `The API returned an unexpected ${what} response.`);
  return body;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function abortError(): DOMException {
  return new DOMException("The request was aborted.", "AbortError");
}

/** Talks to the HTTP API described in docs/frontend-api-contract.md. */
export function createHttpGuitarLabService(
  baseUrl: string,
  fetchImpl: FetchLike = (...args) => fetch(...args),
  createXhr: XhrFactory = () => new XMLHttpRequest(),
): GuitarLabService {
  const base = baseUrl.replace(/\/+$/, "");

  async function request(path: string, init: RequestInit): Promise<unknown> {
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
    if (!response.ok) throw errorFromStatus(response.status, body);
    return body;
  }

  const get = (path: string, signal?: AbortSignal) =>
    request(path, signal ? { method: "GET", signal } : { method: "GET" });

  /** XHR rather than fetch: fetch cannot report upload progress. */
  function upload(path: string, form: FormData, options?: UploadRequestOptions): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const signal = options?.signal;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const xhr = createXhr();
      const onAbort = () => xhr.abort();
      xhr.open("POST", `${base}${path}`);
      xhr.setRequestHeader("Accept", "application/json");
      xhr.upload.onprogress = (event) => {
        options?.onUploadProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : null });
      };
      xhr.onload = () => {
        signal?.removeEventListener("abort", onAbort);
        const body = parseJson(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(errorFromStatus(xhr.status, body));
      };
      xhr.onerror = () => {
        signal?.removeEventListener("abort", onAbort);
        reject(new ServiceError("network_error", "Could not reach the Guitar Lab API."));
      };
      xhr.onabort = () => {
        signal?.removeEventListener("abort", onAbort);
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      xhr.send(form);
    });
  }

  return {
    async listChordQualities(options) {
      const body = expectShape(await get("/chords/qualities", options?.signal), isChordQualitiesResponse, "chord qualities");
      return body.qualities;
    },
    async getChord({ root, quality }, options) {
      const query = new URLSearchParams({ root, quality });
      return expectShape<ChordResponse>(await get(`/chords?${query}`, options?.signal), isChordResponse, "chord");
    },
    async searchVoicings(body, options) {
      const init: RequestInit = { method: "POST", body: JSON.stringify(body) };
      if (options?.signal) init.signal = options.signal;
      return expectShape<VoicingSearchResponse>(await request("/voicings/search", init), isVoicingSearchResponse, "voicing search");
    },
    async getFretboard({ maxFret, tuning }, options) {
      const query = new URLSearchParams({ maxFret: String(maxFret) });
      if (tuning) query.set("tuning", tuning.join(","));
      return expectShape<FretboardResponse>(await get(`/fretboard?${query}`, options?.signal), isFretboardResponse, "fretboard");
    },
    async analyzeAudio({ file, filename, windowSeconds, options }: AudioAnalysisRequest, requestOptions) {
      const form = new FormData();
      if (filename === undefined) form.append("file", file);
      else form.append("file", file, filename);
      if (windowSeconds !== undefined) form.append("windowSeconds", String(windowSeconds));
      if (options !== undefined) form.append("options", JSON.stringify(options));
      return expectShape<AudioAnalysisResponse>(
        await upload("/audio-analysis", form, requestOptions),
        isAudioAnalysisResponse,
        "audio analysis",
      );
    },
    async optimizeProgression(progressionRequest, options) {
      const init: RequestInit = { method: "POST", body: JSON.stringify(progressionRequest) };
      if (options?.signal) init.signal = options.signal;
      return expectShape(
        await request("/progressions/optimize", init),
        isProgressionOptimizationResponse,
        "progression optimization",
      );
    },
  };
}
