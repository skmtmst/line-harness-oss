import { tracedFetch as fetch, traceRequestInit } from '@line-crm/shared/server';
/** One physical HTTP request, with its entire response body inside the same budget.
 * This transport has no retry loop or journal: its caller owns the durable operation.
 */
export async function boundedHttpRequest(
  url: string, init: RequestInit,
  options: { timeoutMs: number; maxResponseBytes: number; fetch?: typeof fetch },
): Promise<Response> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    const fail = () => {
      void reader?.cancel().catch(() => {});
      reject(new Error('external_request_interrupted'));
    };
    controller.signal.addEventListener('abort', fail, { once: true });
    if (controller.signal.aborted) fail();
    timer = setTimeout(abort, options.timeoutMs);
  });
  const work = async () => {
    controller.signal.throwIfAborted();
    const response = await (options.fetch ?? fetch)(url, traceRequestInit(url, { ...init, signal: controller.signal, redirect: 'manual' }));
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error('external_request_interrupted'); }
    if (!response.body) return response;
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > options.maxResponseBytes) throw new Error('external_response_too_large');
        chunks.push(value);
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  };
  try { return await Promise.race([work(), interrupted]); }
  finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); }
}
