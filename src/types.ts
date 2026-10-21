export type HistoryPeriodMonths = 1 | 3 | 6 | 12 | 36 | 60;

export interface FundPrice {
  readonly date: string;
  readonly price: number;
}

export interface ReturnedDateRange {
  readonly from: string;
  readonly to: string;
}

export interface PriceHistory {
  readonly fundCode: string;
  readonly fundName: string | null;
  readonly periodMonths: HistoryPeriodMonths;
  readonly prices: readonly FundPrice[];
  readonly returnedDateRange: ReturnedDateRange | null;
}

export interface TefasClientOptions {
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export interface GetPriceHistoryOptions {
  readonly periodMonths: HistoryPeriodMonths;
  readonly signal?: AbortSignal;
}
