import { TefasError } from "./errors.js";
import type { FundPrice, HistoryPeriodMonths, PriceHistory } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function invalidResponse(message: string): never {
  throw new TefasError("INVALID_RESPONSE", message);
}

export function parsePriceHistory(payload: unknown, fundCode: string, periodMonths: HistoryPeriodMonths): PriceHistory {
  if (!isRecord(payload)) {
    invalidResponse("Expected a response object");
  }

  const sourceCode = payload.errorCode;
  const sourceMessage = payload.errorMessage;

  if (sourceCode !== null && typeof sourceCode !== "string" && typeof sourceCode !== "number") {
    invalidResponse("Missing or invalid source error code.");
  }

  if (
    (typeof sourceCode === "number" && !Number.isFinite(sourceCode)) ||
    (typeof sourceCode === "string" && sourceCode.trim() === "")
  ) {
    invalidResponse("Invalid source error code.");
  }

  if (sourceMessage !== null && typeof sourceMessage !== "string") {
    invalidResponse("Missing or invalid source error message.");
  }

  if (
    (sourceCode !== null && sourceCode !== 0 && sourceCode !== "0") ||
    (typeof sourceMessage === "string" && sourceMessage.trim() !== "")
  ) {
    throw new TefasError(
      "SOURCE_ERROR",
      "The data source reported a failed operation.",
      sourceCode === null ? {} : { sourceCode },
    );
  }

  if (!Array.isArray(payload.resultList)) {
    invalidResponse("Missing or invalid resultList");
  }

  const rows: unknown[] = payload.resultList;
  const byDate = new Map<string, FundPrice>();
  let fundName: string | null = null;

  for (const row of rows) {
    if (!isRecord(row)) {
      invalidResponse("Expected a price history row object.");
    }

    if (row.fonKodu !== fundCode) {
      invalidResponse("The response contains a different fund code.");
    }

    if (typeof row.fonUnvan !== "string" || row.fonUnvan.trim() === "") {
      invalidResponse("Missing or invalid fund name.");
    }

    const title = row.fonUnvan.trim();
    if (fundName !== null && fundName !== title) {
      invalidResponse("The response contains conflicting fund names.");
    }

    fundName = title;

    if (!isDateString(row.tarih)) {
      invalidResponse("Invalid price history date.");
    }

    if (typeof row.fiyat !== "number" || !Number.isFinite(row.fiyat) || row.fiyat < 0) {
      invalidResponse("Invalid price history value.");
    }

    const price: FundPrice = { date: row.tarih, price: row.fiyat };
    const previous = byDate.get(price.date);

    if (previous !== undefined && previous.price !== price.price) {
      invalidResponse("The response contains conflicting prices for one date.");
    }

    byDate.set(price.date, price);
  }

  const prices = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const first = prices[0];
  const last = prices[prices.length - 1];

  return {
    fundCode,
    fundName,
    periodMonths,
    prices,
    returnedDateRange: first !== undefined && last !== undefined ? { from: first.date, to: last.date } : null,
  };
}
