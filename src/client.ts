import { TefasError } from "./errors.js";
import { parseAllocation } from "./allocation.js";
import { parseFundListings } from "./fund-list.js";
import { parsePriceHistory } from "./parser.js";
import { resolveHistoryPeriod, toSourcePeriod } from "./periods.js";
import { executeRequest, withRequestContext } from "./request.js";
import { dailyRequestBody, parseSnapshots, validateSnapshotOptions } from "./snapshots.js";
import { postJson, requestPriceHistory } from "./transport.js";
import { isRecord, normalizeFundCode } from "./validation.js";
import type { FundAllocation, FundListing, FundSnapshot, GetPriceHistoryOptions, GetSnapshotsOptions, PriceHistory, TefasClientOptions } from "./types.js";

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

  async listFunds(options: { readonly signal?: AbortSignal } = {}): Promise<readonly FundListing[]> {
    if (!isRecord(options) || Object.keys(options).some((key) => key !== "signal")) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid fund list options.");
    }
    const signal = options.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid cancellation signal.");
    }
    return withRequestContext(this.timeoutMs, signal, (request) =>
      executeRequest(
        request,
        this.maxRetries,
        (requestSignal) => postJson("https://www.tefas.gov.tr/api/statistics/tefas/getFplFonList", {}, globalThis.fetch, requestSignal),
        parseFundListings,
      ),
    );
  }

  async getAllocation(fundCode: string, options: GetSnapshotsOptions): Promise<FundAllocation | null> {
    const normalizedCode = normalizeFundCode(fundCode);
    const { date, kind, signal } = validateSnapshotOptions(options);
    const body = { ...dailyRequestBody(normalizedCode, kind, date), fonKod: normalizedCode };
    return withRequestContext(this.timeoutMs, signal, (request) =>
      executeRequest(
        request,
        this.maxRetries,
        (requestSignal) => postJson("https://www.tefas.gov.tr/api/funds/dagilimSiraliGetirT", body, globalThis.fetch, requestSignal),
        (payload) => parseAllocation(payload, normalizedCode, kind, date),
      ),
    );
  }

  async getSnapshots(options: GetSnapshotsOptions): Promise<readonly FundSnapshot[]> {
    return this.requestSnapshots(null, options);
  }

  async getSnapshot(fundCode: string, options: GetSnapshotsOptions): Promise<FundSnapshot | null> {
    const normalizedCode = normalizeFundCode(fundCode);
    const snapshots = await this.requestSnapshots(normalizedCode, options);
    return snapshots[0] ?? null;
  }

  private async requestSnapshots(fundCode: string | null, options: GetSnapshotsOptions): Promise<readonly FundSnapshot[]> {
    const { date, kind, signal } = validateSnapshotOptions(options);
    const body = dailyRequestBody(fundCode, kind, date);
    return withRequestContext(this.timeoutMs, signal, (request) =>
      executeRequest(
        request,
        this.maxRetries,
        (requestSignal) => postJson("https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir", body, globalThis.fetch, requestSignal),
        (payload) => parseSnapshots(payload, kind, date, fundCode ?? undefined),
      ),
    );
  }

  async getPriceHistory(fundCode: string, options: GetPriceHistoryOptions): Promise<PriceHistory> {
    const normalizedCode = normalizeFundCode(fundCode);
    if (!isRecord(options) || Object.keys(options).some((key) => key !== "periodMonths" && key !== "period" && key !== "signal")) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid price history options.");
    }
    const period = resolveHistoryPeriod(options);
    const signal = options.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid cancellation signal.");
    }

    return withRequestContext(this.timeoutMs, signal, (request) =>
      executeRequest(
        request,
        this.maxRetries,
        (requestSignal) => requestPriceHistory(normalizedCode, toSourcePeriod(period), globalThis.fetch, requestSignal),
        (payload) => parsePriceHistory(payload, normalizedCode, period),
      ),
    );
  }
}
