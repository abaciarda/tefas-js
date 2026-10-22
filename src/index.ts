export { TefasClient } from "./client.js";
export { TefasError } from "./errors.js";
export { searchFunds } from "./search.js";
export { topFunds, summarizeMarket } from "./market.js";

export type { TefasErrorCode, TefasErrorOptions } from "./errors.js";

export type {
  AllocationKey,
  BenchmarkKey,
  FundAllocation,
  FundComparison,
  FundKind,
  FundListing,
  FundPrice,
  FundSnapshot,
  FundType,
  GetComparisonOptions,
  GetDailyHistoryOptions,
  GetFundTypeOptions,
  GetPriceHistoryOptions,
  GetSnapshotsOptions,
  HistoryPeriod,
  HistoryPeriodMonths,
  MarketSummary,
  PriceHistory,
  ReturnedDateRange,
  TefasClientOptions,
} from "./types.js";
