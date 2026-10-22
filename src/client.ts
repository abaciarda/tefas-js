import { TefasError } from "./errors.js";
import { parseAllocation } from "./allocation.js";
import { parseComparison } from "./comparison.js";
import { mergeDailySnapshots, parseDailyChunk, validateDailyHistoryOptions } from "./daily-history.js";
import { parseFundListings } from "./fund-list.js";
import { parseFundType } from "./fund-type.js";
import { parsePriceHistory } from "./parser.js";
import { isHistoryPeriod, resolveHistoryPeriod, toSourcePeriod } from "./periods.js";
import { executeRequest, withRequestContext } from "./request.js";
import { waitForRetry } from "./retry.js";
import { dailyRequestBody, parseSnapshots, validateSnapshotOptions } from "./snapshots.js";
import { postJson, requestPriceHistory } from "./transport.js";
import { isRecord, normalizeFundCode } from "./validation.js";
import type {
  FundAllocation, FundComparison, FundListing, FundSnapshot, FundType, GetComparisonOptions, GetDailyHistoryOptions, GetFundTypeOptions,
  GetPriceHistoryOptions, GetSnapshotsOptions, PriceHistory, TefasClientOptions,
} from "./types.js";

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

  async getComparison(fundCode: string, options: GetComparisonOptions): Promise<FundComparison> {
    const normalizedCode = normalizeFundCode(fundCode);
    if (!isRecord(options) || Object.keys(options).some((key) => key !== "period" && key !== "signal")) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid comparison options.");
    }
    const period = options.period;
    if (!isHistoryPeriod(period)) throw new TefasError("INVALID_ARGUMENT", "Unsupported comparison period.");
    const signal = options.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid cancellation signal.");
    }
    const body = { fonKodu: normalizedCode, dil: "TR", periyod: toSourcePeriod(period) };
    return withRequestContext(this.timeoutMs, signal, (request) =>
      executeRequest(
        request,
        this.maxRetries,
        (requestSignal) => postJson("https://www.tefas.gov.tr/api/funds/fonProfilDtyGetir", body, globalThis.fetch, requestSignal),
        (payload) => parseComparison(payload, normalizedCode, period),
      ),
    );
  }

  async getFundType(fundCode: string, options: GetFundTypeOptions = {}): Promise<FundType | null> {
    const normalizedCode = normalizeFundCode(fundCode);
    if (!isRecord(options) || Object.keys(options).some((key) => key !== "signal")) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid fund type options.");
    }
    const signal = options.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid cancellation signal.");
    }
    return withRequestContext(this.timeoutMs, signal, (request) =>
      executeRequest(
        request,
        this.maxRetries,
        (requestSignal) => postJson("https://www.tefas.gov.tr/api/funds/fonTipiGetir", { fonKodu: normalizedCode }, globalThis.fetch, requestSignal),
        parseFundType,
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

  async getDailyHistory(fundCode: string, options: GetDailyHistoryOptions): Promise<readonly FundSnapshot[]> {
    const normalizedCode = normalizeFundCode(fundCode);
    const { chunks, kind, minIntervalMs, timeoutMs, onProgress, signal } = validateDailyHistoryOptions(options, this.timeoutMs);
    let lastStart: number | undefined;
    const pace = async (paceSignal: AbortSignal) => {
      const delay = lastStart === undefined ? 0 : minIntervalMs - (performance.now() - lastStart);
      if (delay > 0) await waitForRetry(delay, paceSignal);
    };
    return withRequestContext(timeoutMs, signal, async (history) => {
      const byDate = new Map<string, FundSnapshot>();
      for (const [index, chunk] of chunks.entries()) {
        await pace(history.signal);
        const body = dailyRequestBody(normalizedCode, kind, chunk.from, chunk.to);
        const snapshots = await withRequestContext(this.timeoutMs, history.signal, (request) =>
          executeRequest(
            request,
            this.maxRetries,
            async (requestSignal) => {
              await pace(requestSignal);
              lastStart = performance.now();
              return postJson("https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir", body, globalThis.fetch, requestSignal);
            },
            (payload) => parseDailyChunk(payload, normalizedCode, kind, chunk),
          ),
        );
        mergeDailySnapshots(byDate, snapshots);
        onProgress?.({ completed: index + 1, total: chunks.length });
      }
      return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
    });
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
