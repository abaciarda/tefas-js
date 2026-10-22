import { TefasError } from "./errors.js";
import type { FundKind, FundSnapshot, MarketSummary } from "./types.js";
import { isDateString, isFundCode, isFundKind, isNonEmptyString, isNonNegativeNumber, isRecord } from "./validation.js";

function validateSnapshots(value: unknown): asserts value is readonly FundSnapshot[] {
  if (!Array.isArray(value)) throw new TefasError("INVALID_ARGUMENT", "Expected a snapshot array.");
  const rows: readonly unknown[] = value;
  for (const row of rows) {
    if (!isRecord(row) || !isFundCode(row.fundCode) || !isNonEmptyString(row.fundName) ||
      !isFundKind(row.kind) || !isDateString(row.date) || !isNonNegativeNumber(row.price)) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid market snapshot.");
    }
    for (const key of ["sharesOutstanding", "investorCount", "portfolioSize"]) {
      if (row[key] !== null && !isNonNegativeNumber(row[key])) {
        throw new TefasError("INVALID_ARGUMENT", "Invalid numeric market snapshot field.");
      }
    }
  }
}

export function topFunds(
  snapshots: readonly FundSnapshot[],
  options: { readonly by: "portfolioSize" | "investorCount"; readonly limit: number },
): readonly FundSnapshot[] {
  validateSnapshots(snapshots);
  if (!isRecord(options) || Object.keys(options).some((key) => key !== "by" && key !== "limit") ||
    (options.by !== "portfolioSize" && options.by !== "investorCount") ||
    !Number.isInteger(options.limit) || options.limit < 1) {
    throw new TefasError("INVALID_ARGUMENT", "Invalid fund ranking options.");
  }
  const { by, limit } = options;
  return snapshots
    .flatMap((snapshot) => {
      const value = snapshot[by];
      return value === null ? [] : [{ snapshot, value }];
    })
    .sort((left, right) => right.value - left.value || left.snapshot.fundCode.localeCompare(right.snapshot.fundCode))
    .slice(0, limit)
    .map(({ snapshot }) => snapshot);
}

export function summarizeMarket(snapshots: readonly FundSnapshot[]): MarketSummary {
  validateSnapshots(snapshots);
  const first = snapshots[0];
  let kind: FundKind | null = first?.kind ?? null;
  let date: string | null = first?.date ?? null;
  let totalPortfolioSize = 0;
  let totalInvestorCount = 0;
  for (const snapshot of snapshots) {
    if (snapshot.kind !== kind) kind = null;
    if (snapshot.date !== date) date = null;
    totalPortfolioSize += snapshot.portfolioSize ?? 0;
    totalInvestorCount += snapshot.investorCount ?? 0;
  }
  if (!Number.isFinite(totalPortfolioSize) || !Number.isFinite(totalInvestorCount)) {
    throw new TefasError("INVALID_ARGUMENT", "Market totals exceed the supported numeric range.");
  }
  return { kind, date, fundCount: snapshots.length, totalPortfolioSize, totalInvestorCount };
}
