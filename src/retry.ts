import { TefasError } from "./errors.js";

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRY_WAIT_MS = 60_000;

export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  if (text === "") return Infinity;

  if (/^\d+$/.test(text)) {
    const milliseconds = Number(text) * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : Infinity;
  }

  const time = Date.parse(text);
  if (!Number.isFinite(time) || new Date(time).toUTCString() !== text) {
    return Infinity;
  }

  return Math.max(0, time - now);
}

export function getRetryDelay(
  error: unknown,
  retryIndex: number,
  random: () => number = Math.random,
): number | undefined {
  if (!(error instanceof TefasError)) return undefined;
  const eligible =
    error.code === "NETWORK_ERROR" ||
    (error.code === "HTTP_ERROR" && error.status !== undefined && RETRY_STATUSES.has(error.status));
  if (!eligible) return undefined;

  const backoff = Math.min(2000, Math.round(250 * 2 ** retryIndex * (0.5 + random())));
  const delay = Math.max(backoff, error.retryAfterMs ?? 0);
  return Number.isFinite(delay) && delay <= MAX_RETRY_WAIT_MS ? delay : undefined;
}

export function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
