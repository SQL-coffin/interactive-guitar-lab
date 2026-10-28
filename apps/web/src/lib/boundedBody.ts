import { apiError } from "./api";

export type BoundedFormDataResult = { ok: true; form: FormData } | { ok: false; response: Response };

/**
 * Parses multipart form data without ever buffering more than `maxBytes`.
 * A declared Content-Length above the limit is rejected without reading the body. Bodies without
 * a usable length (for example chunked uploads) are streamed through a byte counter and abandoned
 * as soon as they cross the limit, so the limit holds even when the header is missing or wrong.
 */
export async function readBoundedFormData(request: Request, maxBytes: number): Promise<BoundedFormDataResult> {
  const tooLarge = () => ({
    ok: false as const,
    response: apiError(413, "invalid_request", `Request body must be ${Math.floor(maxBytes / (1024 * 1024))} MiB or smaller.`),
  });
  const notMultipart = () => ({
    ok: false as const,
    response: apiError(400, "invalid_request", "Request body must be multipart form data."),
  });

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) return notMultipart();

  const declared = request.headers.get("content-length");
  if (declared !== null && declared.trim() !== "") {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) return tooLarge();
  }
  if (!request.body) return notMultipart();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      return tooLarge();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, form: await new Response(body, { headers: { "content-type": contentType } }).formData() };
  } catch {
    return notMultipart();
  }
}
