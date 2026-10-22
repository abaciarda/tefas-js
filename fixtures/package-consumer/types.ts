import { TefasClient, TefasError, searchFunds } from 'tefas-js';
import type {
  GetPriceHistoryOptions,
  FundListing,
  HistoryPeriod,
  HistoryPeriodMonths,
  PriceHistory,
  TefasClientOptions,
  TefasErrorCode,
} from 'tefas-js';

const clientOptions: TefasClientOptions = { timeoutMs: 1000, maxRetries: 1 };
const client = new TefasClient(clientOptions);
const period: HistoryPeriodMonths = 12;
const options: GetPriceHistoryOptions = {
  periodMonths: period,
  signal: new AbortController().signal,
};
const result: Promise<PriceHistory> = client.getPriceHistory('TI2', options);
const namedPeriod: HistoryPeriod = 'ytd';
const namedOptions: GetPriceHistoryOptions = { period: namedPeriod };
const namedResult: Promise<PriceHistory> = client.getPriceHistory('TI2', namedOptions);
const code: TefasErrorCode = 'TIMEOUT';
const error: Error = new TefasError(code, 'Example failure', { cause: new Error('Root cause') });
void result;
void namedResult;
void error;
const listings: Promise<readonly FundListing[]> = client.listFunds({ signal: new AbortController().signal });
const extended = [{ fundCode: 'TI2', fundName: 'İŞ PORTFÖY', price: 1, kind: 'YAT' as const }];
const found = searchFunds(extended, 'is');
const price: number | undefined = found[0]?.price;
const kind: 'YAT' | undefined = found[0]?.kind;
void listings;
void price;
void kind;

// @ts-expect-error Listing rejects unknown options.
client.listFunds({ typo: true });
// @ts-expect-error Listing cancellation requires an AbortSignal.
client.listFunds({ signal: {} });
// @ts-expect-error Search queries must be strings.
searchFunds([], 42);
// @ts-expect-error Search entries must include the fund name.
searchFunds([{ fundCode: 'TI2' }], 'TI2');

// @ts-expect-error Unsupported periods must be rejected.
client.getPriceHistory('TI2', { periodMonths: 2 });
// @ts-expect-error The period is required.
client.getPriceHistory('TI2', {});
// @ts-expect-error Named periods must be supported.
client.getPriceHistory('TI2', { period: '12m' });
// @ts-expect-error Both period formats cannot be supplied together.
client.getPriceHistory('TI2', { period: '1y', periodMonths: 12 });
// @ts-expect-error An explicitly undefined second period is still invalid.
client.getPriceHistory('TI2', { period: '1w', periodMonths: undefined });
// @ts-expect-error Timeout must be numeric.
new TefasClient({ timeoutMs: '1000' });
// @ts-expect-error Cancellation requires an AbortSignal.
client.getPriceHistory('TI2', { periodMonths: 1, signal: {} });

function checkReadonly(history: PriceHistory) {
  const months: HistoryPeriodMonths | null = history.periodMonths;
  const periodName: HistoryPeriod = history.period;
  void months;
  void periodName;
  // @ts-expect-error Weekly and YTD periods do not have a month count.
  const requiredMonths: HistoryPeriodMonths = history.periodMonths;
  void requiredMonths;
  // @ts-expect-error Public price arrays are readonly.
  history.prices.push({ date: '2026-10-20', price: 2 });
}
void checkReadonly;

function checkListings(funds: readonly FundListing[]) {
  // @ts-expect-error Listing arrays are readonly.
  funds.push({ fundCode: 'TI2', fundName: 'İŞ PORTFÖY', founderCode: null, founderName: null });
  const first = funds[0];
  if (first) {
    const founder: string | null = first.founderName;
    void founder;
    // @ts-expect-error Founder fields are readonly.
    first.founderName = 'Other';
  }
  // @ts-expect-error Search results are readonly.
  found.push(extended[0]!);
}
void checkListings;
