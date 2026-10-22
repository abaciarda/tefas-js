import { TefasClient, TefasError, searchFunds, topFunds, summarizeMarket } from 'tefas-js';
import type {
  GetPriceHistoryOptions,
  AllocationKey,
  BenchmarkKey,
  FundComparison,
  FundType,
  GetComparisonOptions,
  GetDailyHistoryOptions,
  GetFundTypeOptions,
  FundAllocation,
  FundListing,
  FundSnapshot,
  GetSnapshotsOptions,
  HistoryPeriod,
  HistoryPeriodMonths,
  PriceHistory,
  MarketSummary,
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
const snapshotOptions: GetSnapshotsOptions = { date: '2026-10-20', kind: 'EMK', signal: new AbortController().signal };
const snapshotResult: Promise<FundSnapshot | null> = client.getSnapshot('AE1', snapshotOptions);
const snapshotsResult: Promise<readonly FundSnapshot[]> = client.getSnapshots(snapshotOptions);
void snapshotResult;
void snapshotsResult;
const allocationResult: Promise<FundAllocation | null> = client.getAllocation('AE1', snapshotOptions);
const stockKey: AllocationKey = 'stock';
void allocationResult;
void stockKey;

// @ts-expect-error Allocation needs a date.
client.getAllocation('TI2', {});
// @ts-expect-error Allocation only accepts supported fund kinds.
client.getAllocation('TI2', { date: '2026-10-20', kind: 'F' });

// @ts-expect-error A snapshot date is required.
client.getSnapshots({});
// @ts-expect-error Snapshot dates must be strings.
client.getSnapshot('TI2', { date: new Date() });
// @ts-expect-error Only supported fund kinds are accepted.
client.getSnapshots({ date: '2026-10-20', kind: 'F' });
// @ts-expect-error Snapshot options reject unknown keys.
client.getSnapshots({ date: '2026-10-20', typo: true });
// @ts-expect-error Fund ranking only accepts supported fields.
topFunds([], { by: 'price', limit: 1 });
// @ts-expect-error Fund ranking requires a numeric limit.
topFunds([], { by: 'portfolioSize', limit: '1' });

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

function checkSnapshots(snapshots: readonly FundSnapshot[]) {
  const ranked: readonly FundSnapshot[] = topFunds(snapshots, { by: 'investorCount', limit: 5 });
  const summary: MarketSummary = summarizeMarket(snapshots);
  const matches: readonly FundSnapshot[] = searchFunds(snapshots, 'is');
  void ranked;
  void matches;
  // @ts-expect-error Snapshot arrays are readonly.
  snapshots.reverse();
  // @ts-expect-error Market summaries are readonly.
  summary.fundCount = 0;
  const first = snapshots[0];
  if (first) {
    const investors: number | null = first.investorCount;
    void investors;
    // @ts-expect-error Snapshot fields are readonly.
    first.price = 0;
  }
}
void checkSnapshots;

function checkAllocation(allocation: FundAllocation) {
  const stock: number | undefined = allocation.weights.stock;
  void stock;
  // @ts-expect-error Allocation percentages are readonly.
  allocation.weights.stock = 100;
  // @ts-expect-error The weights object is readonly.
  allocation.weights = {};
  // @ts-expect-error Unknown allocation keys are not exposed.
  allocation.weights.unknownBucket;
  // @ts-expect-error Allocation metadata is readonly.
  allocation.date = '2026-10-21';
}
void checkAllocation;

const comparisonOptions: GetComparisonOptions = { period: '1w', signal: new AbortController().signal };
const comparisonResult: Promise<FundComparison> = client.getComparison('TI2', comparisonOptions);
const fundTypeOptions: GetFundTypeOptions = { signal: new AbortController().signal };
const fundTypeResult: Promise<FundType | null> = client.getFundType('TI2', fundTypeOptions);
const defaultFundType: Promise<'investment' | 'pension' | null> = client.getFundType('AE1');
const benchmarkKey: BenchmarkKey = 'umbrellaCategory';
void comparisonResult;
void fundTypeResult;
void defaultFundType;
void benchmarkKey;

// @ts-expect-error Comparisons require a period.
client.getComparison('TI2', {});
// @ts-expect-error Comparisons only accept supported named periods.
client.getComparison('TI2', { period: '12m' });
// @ts-expect-error Comparisons do not accept month counts.
client.getComparison('TI2', { periodMonths: 12 });
// @ts-expect-error Comparisons do not accept a fund kind.
client.getComparison('TI2', { period: '1y', kind: 'YAT' });
// @ts-expect-error Fund type cancellation requires an AbortSignal.
client.getFundType('TI2', { signal: {} });
// @ts-expect-error Fund type options reject unknown keys.
client.getFundType('TI2', { kind: 'YAT' });
// @ts-expect-error Fund kinds are not fund types.
const wrongType: FundType = 'YAT';
void wrongType;
// @ts-expect-error Unknown benchmarks are not exposed.
const wrongBenchmark: BenchmarkKey = 'hedgeFundUmbrella';
void wrongBenchmark;

function checkComparison(comparison: FundComparison) {
  const fundReturn: number | null = comparison.fundReturn;
  const gold: number | undefined = comparison.benchmarks.gold;
  void fundReturn;
  void gold;
  // @ts-expect-error Comparison returns are readonly.
  comparison.fundReturn = 0;
  // @ts-expect-error Benchmark returns are readonly.
  comparison.benchmarks.gold = 0;
  // @ts-expect-error The benchmark map is readonly.
  comparison.benchmarks = {};
  // @ts-expect-error Comparison periods are readonly.
  comparison.period = '1y';
}
void checkComparison;

type DailyHistoryProgress = Parameters<NonNullable<GetDailyHistoryOptions['onProgress']>>[0];
const dailyOptions: GetDailyHistoryOptions = {
  from: '2026-09-01',
  to: '2026-10-10',
  kind: 'EMK',
  minIntervalMs: 0,
  timeoutMs: 60_000,
  onProgress: (progress: DailyHistoryProgress) => {
    const completed: number = progress.completed;
    const total: number = progress.total;
    void completed;
    void total;
    // @ts-expect-error Progress values are readonly.
    progress.completed = 0;
  },
  signal: new AbortController().signal,
};
const dailyResult: Promise<readonly FundSnapshot[]> = client.getDailyHistory('TI2', dailyOptions);
void dailyResult;

// @ts-expect-error Daily history needs both range ends.
client.getDailyHistory('TI2', { from: '2026-09-01' });
// @ts-expect-error Daily history only accepts supported fund kinds.
client.getDailyHistory('TI2', { from: '2026-09-01', to: '2026-10-10', kind: 'F' });
// @ts-expect-error Daily history dates must be strings.
client.getDailyHistory('TI2', { from: new Date(), to: '2026-10-10' });
// @ts-expect-error The request interval must be numeric.
client.getDailyHistory('TI2', { from: '2026-09-01', to: '2026-10-10', minIntervalMs: '0' });
// @ts-expect-error The progress callback must be a function.
client.getDailyHistory('TI2', { from: '2026-09-01', to: '2026-10-10', onProgress: {} });
// @ts-expect-error Daily history rejects unknown keys.
client.getDailyHistory('TI2', { from: '2026-09-01', to: '2026-10-10', period: '1y' });

function checkDailyHistory(history: readonly FundSnapshot[]) {
  // @ts-expect-error Daily history arrays are readonly.
  history.push(history[0]!);
  const first = history[0];
  if (first) {
    // @ts-expect-error Daily snapshot fields are readonly.
    first.date = '2026-09-02';
  }
}
void checkDailyHistory;
