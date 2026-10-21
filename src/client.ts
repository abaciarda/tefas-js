import { TefasError } from "./errors.js";
import { parsePriceHistory } from "./parser.js";
import { executeRequest, withRequestContext } from "./request.js";
import { requestPriceHistory } from "./transport.js";
import { isRecord, normalizeFundCode } from "./validation.js";
import type { GetPriceHistoryOptions, HistoryPeriodMonths, PriceHistory, TefasClientOptions } from "./types.js";

const SUPPORTED_PERIODS: readonly number[] = [1, 3, 6, 12, 36, 60];

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

    return withRequestContext(this.timeoutMs, signal, (request) =>
      executeRequest(
        request,
        this.maxRetries,
        (requestSignal) => requestPriceHistory(normalizedCode, periodMonths, globalThis.fetch, requestSignal),
        (payload) => parsePriceHistory(payload, normalizedCode, periodMonths),
      ),
    );
  }
}
