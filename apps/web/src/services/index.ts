import { createHttpGuitarLabService } from "./httpAdapter";
import { createLocalGuitarLabService } from "./localAdapter";
import type { GuitarLabService } from "./guitarLabService";

export type { GuitarLabService, RequestOptions, UploadProgress, UploadRequestOptions } from "./guitarLabService";
export { ServiceError, isAbortError } from "./errors";
export { createHttpGuitarLabService } from "./httpAdapter";
export { createLocalGuitarLabService } from "./localAdapter";
export * from "./contract";

/**
 * Uses the live HTTP routes under `NEXT_PUBLIC_GUITAR_LAB_API_URL` (default: same-origin "/api").
 * Set it to "local" to run against the in-process engine adapter without a server.
 */
export function createDefaultGuitarLabService(): GuitarLabService {
  const apiUrl = process.env.NEXT_PUBLIC_GUITAR_LAB_API_URL ?? "/api";
  return apiUrl === "local" ? createLocalGuitarLabService() : createHttpGuitarLabService(apiUrl);
}
