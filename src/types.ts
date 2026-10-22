export type HistoryPeriodMonths = 1 | 3 | 6 | 12 | 36 | 60;

export type HistoryPeriod = "1w" | "1m" | "3m" | "6m" | "ytd" | "1y" | "3y" | "5y";

export type FundKind = "YAT" | "EMK" | "BYF" | "GYF" | "GSYF";

export interface FundListing {
  readonly fundCode: string;
  readonly fundName: string;
  readonly founderCode: string | null;
  readonly founderName: string | null;
}

export interface FundSnapshot {
  readonly fundCode: string;
  readonly fundName: string;
  readonly kind: FundKind;
  readonly date: string;
  readonly price: number;
  readonly sharesOutstanding: number | null;
  readonly investorCount: number | null;
  readonly portfolioSize: number | null;
}

export interface GetSnapshotsOptions {
  readonly date: string;
  readonly kind?: FundKind;
  readonly signal?: AbortSignal;
}

export type AllocationKey =
  | "stock" | "governmentBond" | "treasuryBill" | "financingBill" | "privateSectorBond" | "bankBill"
  | "assetBackedSecurities" | "eurobond" | "governmentExternalDebt" | "privateSectorExternalDebt"
  | "fxGovernmentInternalDebt" | "fxPayableBill" | "fxPayableBond"
  | "takasbankMoneyMarket" | "bistMoneyMarket" | "bistCommittedBuy" | "bistCommittedSell" | "repo" | "reverseRepo"
  | "termDeposit" | "depositTl" | "depositFx" | "depositGold"
  | "participationAccount" | "participationAccountTl" | "participationAccountFx" | "participationAccountGold"
  | "governmentLeaseCertificate" | "governmentLeaseCertificateTl" | "governmentLeaseCertificateFx"
  | "governmentForeignLeaseCertificate" | "privateSectorLeaseCertificate" | "privateSectorForeignLeaseCertificate"
  | "preciousMetals" | "preciousMetalsEtf" | "preciousMetalsGovernmentDebt" | "preciousMetalsLeaseCertificate"
  | "foreignSecurity" | "foreignDebtSecurity" | "foreignGovernmentDebt" | "foreignPrivateSectorDebt" | "foreignStock" | "foreignEtf"
  | "fundParticipationCertificate" | "investmentFund" | "etf" | "realEstateFund" | "realEstateInvestment"
  | "ventureCapitalFund" | "ventureCapitalInvestment"
  | "derivative" | "futuresCashCollateral" | "realEstateCertificate" | "other";

export interface FundAllocation {
  readonly fundCode: string;
  readonly fundName: string;
  readonly kind: FundKind;
  readonly date: string;
  readonly weights: Readonly<Partial<Record<AllocationKey, number>>>;
}

export interface MarketSummary {
  readonly kind: FundKind | null;
  readonly date: string | null;
  readonly fundCount: number;
  readonly totalPortfolioSize: number;
  readonly totalInvestorCount: number;
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
