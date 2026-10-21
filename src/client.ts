import { TefasError } from "./errors.js";
import { parsePriceHistory } from "./parser.js";
import { createRequestContext } from "./request-context.js";
import { getRetryDelay, waitForRetry } from "./retry.js";
import { requestPriceHistory } from "./transport.js";
import type { GetPriceHistoryOptions, HistoryPeriodMonths, PriceHistory, TefasClientOptions } from "./types.js";

const SUPPORTED_PERIODS: readonly number[] = [1, 3, 6, 12, 36, 60];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFundCode(value: unknown): string {
  if (typeof value !== "string") {
    throw new TefasError("INVALID_ARGUMENT", "Fund code must be a string.");
  }
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(normalized)) {
    throw new TefasError("INVALID_ARGUMENT", "Fund code must contain exactly three ASCII letters or digits.");
  }
  return normalized;
}

function isSupportedPeriod(value: unknown): value is HistoryPeriodMonths {
  return typeof value === "number" && SUPPORTED_PERIODS.includes(value);
}

export class TefasClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: TefasClientOptions = {}) {
    if (!isRecord(options) || Object.keys(options).some((key) => key !== "timeoutMs" && key !== "maxRetries")) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid client options.");
    }

    const timeoutMs = options.timeoutMs === undefined ? 10_000 : options.timeoutMs;
    if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid request timeout.");
    }
    const maxRetries = options.maxRetries === undefined ? 0 : options.maxRetries;
    if (typeof maxRetries !== "number" || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) {
      throw new TefasError("INVALID_ARGUMENT", "maxRetries must be an integer from 0 to 2.");
    }
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
  }

  async getPriceHistory(fundCode: string, options: GetPriceHistoryOptions): Promise<PriceHistory> {
    const normalizedCode = normalizeFundCode(fundCode);
    if (!isRecord(options) || Object.keys(options).some((key) => key !== "periodMonths" && key !== "signal")) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid price history options.");
    }
    const periodMonths = options.periodMonths;
    const signal = options.signal;
    if (!isSupportedPeriod(periodMonths)) {
      throw new TefasError("INVALID_ARGUMENT", "Unsupported history period.");
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid cancellation signal.");
    }

    const request = createRequestContext(this.timeoutMs, signal);
    let retryIndex = 0;
    try {
      for (;;) {
        request.signal.throwIfAborted();
        try {
          const payload = await requestPriceHistory(normalizedCode, periodMonths, globalThis.fetch, request.signal);
          request.signal.throwIfAborted();
          return parsePriceHistory(payload, normalizedCode, periodMonths);
        } catch (error) {
          request.signal.throwIfAborted();
          if (retryIndex >= this.maxRetries) throw error;
          const delay = getRetryDelay(error, retryIndex);
          if (delay === undefined) throw error;
          retryIndex += 1;
          await waitForRetry(delay, request.signal);
        }
      }
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
}
