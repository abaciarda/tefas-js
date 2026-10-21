import { TefasError } from "./errors.js";
import { createRequestContext } from "./request-context.js";
import { getRetryDelay, waitForRetry } from "./retry.js";

type RequestContext = ReturnType<typeof createRequestContext>;

export async function withRequestContext<T>(
  timeoutMs: number,
  signal: AbortSignal | undefined,
  run: (request: RequestContext) => Promise<T>,
): Promise<T> {
  const request = createRequestContext(timeoutMs, signal);
  try {
    request.signal.throwIfAborted();
    const result = await run(request);
    request.signal.throwIfAborted();
    return result;
  } catch (cause) {
    const code = request.getAbortCode();
    if (code !== undefined) {
      throw new TefasError(code, code === "TIMEOUT" ? "The request timed out." : "The request was cancelled.", {
        cause: request.signal.reason,
      });
    }
    throw cause;
  } finally {
    request.cleanup();
  }
}

export async function executeRequest<T>(
  request: RequestContext,
  maxRetries: number,
  load: (signal: AbortSignal) => Promise<unknown>,
  parse: (payload: unknown) => T,
): Promise<T> {
  let retryIndex = 0;
  for (;;) {
    request.signal.throwIfAborted();
    try {
      const payload = await load(request.signal);
      request.signal.throwIfAborted();
      return parse(payload);
    } catch (error) {
      request.signal.throwIfAborted();
      if (retryIndex >= maxRetries) throw error;
      const delay = getRetryDelay(error, retryIndex);
      if (delay === undefined) throw error;
      retryIndex += 1;
      await waitForRetry(delay, request.signal);
    }
  }
}
