import type { FundPrice, HistoryPeriodMonths, PriceHistory } from "./types.js";
import { invalidResponse, isDateString, isNonEmptyString, isNonNegativeNumber, isRecord, validateEnvelope } from "./validation.js";

export function parsePriceHistory(payload: unknown, fundCode: string, periodMonths: HistoryPeriodMonths): PriceHistory {
  const response = validateEnvelope(payload);
  if (!Array.isArray(response.resultList)) {
    invalidResponse("Missing or invalid resultList");
  }

  const rows: unknown[] = response.resultList;
  const byDate = new Map<string, FundPrice>();
  let fundName: string | null = null;

  for (const row of rows) {
    if (!isRecord(row)) {
      invalidResponse("Expected a price history row object.");
    }

    if (row.fonKodu !== fundCode) {
      invalidResponse("The response contains a different fund code.");
    }

    if (!isNonEmptyString(row.fonUnvan)) {
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

    if (!isNonNegativeNumber(row.fiyat)) {
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
