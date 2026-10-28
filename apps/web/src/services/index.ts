import { createHttpGuitarLabService } from "./httpAdapter";
import { createLocalGuitarLabService } from "./localAdapter";
import type { GuitarLabService } from "./guitarLabService";

export type { GuitarLabService, RequestOptions } from "./guitarLabService";
export { ServiceError, isAbortError } from "./errors";
export { createHttpGuitarLabService } from "./httpAdapter";
export { createLocalGuitarLabService } from "./localAdapter";
export * from "./contract";

/**
 * `NEXT_PUBLIC_GUITAR_LAB_API_URL` selects the HTTP adapter (e.g. "/api").
 * Unset → the in-process local adapter, until the backend routes ship.
 */
export function createDefaultGuitarLabService(): GuitarLabService {
  const apiUrl = process.env.NEXT_PUBLIC_GUITAR_LAB_API_URL;
  return apiUrl ? createHttpGuitarLabService(apiUrl) : createLocalGuitarLabService();
}
