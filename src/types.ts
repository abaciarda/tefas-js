export type HistoryPeriodMonths = 1 | 3 | 6 | 12 | 36 | 60;

export type HistoryPeriod = "1w" | "1m" | "3m" | "6m" | "ytd" | "1y" | "3y" | "5y";

export type FundKind = "YAT" | "EMK" | "BYF" | "GYF" | "GSYF";

export interface FundListing {
  readonly fundCode: string;
  readonly fundName: string;
  readonly founderCode: string | null;
  readonly founderName: string | null;
}

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
  readonly period: HistoryPeriod;
  readonly periodMonths: HistoryPeriodMonths | null;
  readonly prices: readonly FundPrice[];
  readonly returnedDateRange: ReturnedDateRange | null;
}

export interface TefasClientOptions {
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

export type GetPriceHistoryOptions = {
  readonly signal?: AbortSignal;
} & (
  | { readonly periodMonths: HistoryPeriodMonths; readonly period?: never }
  | { readonly period: HistoryPeriod; readonly periodMonths?: never }
);
