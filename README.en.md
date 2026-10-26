# tefas-js

[English](README.en.md) | [Türkçe](README.md)

An unofficial TEFAS fund data library for JavaScript and TypeScript.

List and search funds, fetch prices and daily data, and retrieve asset allocations and return comparisons. The ESM API includes typed results, cancellation, and optional bounded retries, with no runtime dependencies.

This document also describes the API under development. The new methods are not on npm yet; the published `0.1.1` version supports `getPriceHistory` with `periodMonths`.

> Early release. The public API may change in future 0.x versions.

## Installation

```sh
npm install tefas-js
```

You can also install the published package with pnpm or Bun. The supported runtime target is Node.js 22+. Bun is used for development and is checked separately.

## Usage

```ts
import { TefasClient } from "tefas-js";

const client = new TefasClient({
  timeoutMs: 10_000,
  maxRetries: 0,
});

const history = await client.getPriceHistory("TI2", {
  periodMonths: 12,
});

console.log(history.fundCode);
console.log(history.prices);
console.log(history.returnedDateRange);
```

`periodMonths` accepts `1`, `3`, `6`, `12`, `36`, or `60`. Alternatively, use `period` for named periods, including one week (`1w`) and year to date (`ytd`):

```ts
const weekly = await client.getPriceHistory("TI2", { period: "1w" });
const ytd = await client.getPriceHistory("TI2", { period: "ytd" });
```

The other named periods are `1m`, `3m`, `6m`, `1y`, `3y`, and `5y`. Provide exactly one of `period` or `periodMonths`. Providing both or neither produces `INVALID_ARGUMENT`.

The result always includes `period`. Its `periodMonths` field is `null` for weekly and YTD queries, and the month count for other periods.

Fund codes are trimmed, uppercased, and checked as three ASCII letters or digits.

Prices are sorted from oldest to newest. Dates remain `YYYY-MM-DD` strings and prices are JavaScript numbers. Identical entries for the same date are deduplicated; conflicting prices are rejected.

An empty response produces an empty price array and a `null` returned date range. It does not automatically mean the fund does not exist. The returned range describes the records received, not a guarantee of complete historical coverage.

## Fund listing and search

```ts
import { TefasClient, searchFunds } from "tefas-js";

const client = new TefasClient();
const funds = await client.listFunds();
const found = searchFunds(funds, "is");
```

`listFunds` returns the fund code, name, `founderCode`, and `founderName`. Missing founder information is `null`. Listings are sorted by code, identical entries are deduplicated, and conflicting entries are rejected.

`searchFunds` searches the supplied array without sending requests or changing the input. It handles Turkish letters: `is` also matches `İŞ PORTFÖY`. Exact code matches come first, followed by code prefixes and name matches. Each group is sorted by code. Empty queries are rejected.

Use `listFunds({ signal })` to support cancellation. The client's timeout and retry settings apply. The listing endpoint may cover a different set of funds than the daily data endpoint.

## Daily fund snapshots

```ts
const fund = await client.getSnapshot("TI2", { date: "2026-10-20" });
const snapshots = await client.getSnapshots({ date: "2026-10-20" });
const pension = await client.getSnapshot("AE1", {
  date: "2026-10-20",
  kind: "EMK",
});
```

`getSnapshot` returns one fund's data; `getSnapshots` returns the funds of the selected kind for that date. `date` is required in `YYYY-MM-DD` format. `kind` defaults to `YAT` and also accepts `EMK`, `BYF`, `GYF`, and `GSYF`.

If `kind` does not match the fund's type (for example, a pension fund queried with `YAT`), `getSnapshot` returns `null` rather than an error.

Each snapshot includes the fund code, name, kind, date, price, `sharesOutstanding`, `investorCount`, and `portfolioSize`. The last three fields are `null` when missing. Zero is preserved as zero. Results are sorted by fund code and identical rows are deduplicated. Conflicting rows or unexpected dates are rejected.

No data produces `null` for `getSnapshot` and an empty array for `getSnapshots`. The exact `Index 0 out of bounds for length 0` empty-day response observed during discovery is handled the same way. Other source errors are reported. Data for the current day may not have been published yet. Both methods accept `signal` and use the client's timeout and retry settings.

## Daily history over a date range

```ts
const history = await client.getDailyHistory("TI2", {
  from: "2026-09-01",
  to: "2026-10-10",
  onProgress: ({ completed, total }) => {
    console.log(`${completed}/${total}`);
  },
});
```

`getDailyHistory` returns a fund's daily data between two dates, using the same `FundSnapshot` fields as `getSnapshot`. Both `from` and `to` are inclusive, and equal dates count as one day. Ranges may cover at most **1827 calendar days** (`to − from + 1`, about five years). `kind` defaults to `YAT`.

Results are sorted from oldest to newest. Weekends, holidays, and unpublished days are skipped: no rows are synthesized, prices are not carried forward, and zeros are not filled in. A range with no data returns an empty array.

Unlike `getPriceHistory`, which returns only prices for a fixed period such as `1y`, `getDailyHistory` covers any date range and includes shares outstanding, investor count, and portfolio size.

The range is fetched in sequential 28-day chunks, never in parallel. At least `minIntervalMs` (default `10000`, range `0`–`60000`) passes between the starts of two actual request attempts. The first request is not delayed. Retries count toward the interval, and time already spent waiting to retry is subtracted from it. The limit applies to that call only and does not slow down other methods.

A range near the five-year limit needs about **66 requests** and can take about **11 minutes** at the default pace. This is an estimate, not a fixed duration; it depends on response times, retries, and waiting intervals.

There are two separate time limits:

- The method's `timeoutMs` option limits the whole operation, including intervals and retries. It defaults to `chunk count × (minIntervalMs + the client's timeoutMs)`. This is not a guarantee of success.
- The client's `timeoutMs` applies to each chunk separately, including that chunk's retries. If a chunk needs to retry, the client timeout must be larger than `minIntervalMs`; otherwise the chunk times out while it waits to retry.

Exceeding either limit rejects with `TIMEOUT`; cancelling through `signal` rejects with `ABORTED`. If any chunk fails permanently, the method rejects without a partial result and later chunks are not requested.

`onProgress` is called with `{ completed, total }` after each chunk is processed successfully. `completed` starts at 1, and `total` is the chunk count. Empty chunks count; failed attempts do not. If the callback throws, the same error is rethrown and no further requests are sent.

## Asset allocation

```ts
const allocation = await client.getAllocation("TI2", { date: "2026-10-20" });

console.log(allocation?.weights.stock);
console.log(allocation?.weights.reverseRepo);
```

`getAllocation` returns the fund's allocation for the requested date. It accepts the same `kind` and `signal` options as daily snapshots. Filtering happens on the server; calls do not download allocations for all funds. An empty result returns `null`.

The exact `Index 0 out of bounds for length 0` response verified in the weekend check also returns `null`; other source errors are reported. The source's `bilFiyat` field is not a percentage and is excluded from allocation weights.

`weights` contains percentages: `92.28` means 92.28%. Missing or null entries are omitted, and zero is preserved. Values must be between 0 and 100; totals may differ from 100 by at most 0.5 percentage points. Conflicting rows, unexpected fund codes, and unexpected dates are rejected.

## Return comparison

```ts
const comparison = await client.getComparison("TI2", { period: "1y" });

console.log(comparison.fundReturn);
console.log(comparison.benchmarks.bist100);
console.log(comparison.benchmarks.inflation);
```

`getComparison` returns the fund's return for the selected period together with benchmark returns. `period` accepts the same values as price history: `1w`, `1m`, `3m`, `6m`, `ytd`, `1y`, `3y`, or `5y`.

Returns are **ratios**, not percentages: `0.1166` means 11.66% and `-0.0398` means -3.98%. The fund and its benchmarks use the same unit. Negative and zero returns are preserved.

`benchmarks` may contain `gold`, `bist100`, `bist30`, `eur`, `usd`, `depositRate`, `inflation` (Turkish CPI), and `umbrellaCategory`. `umbrellaCategory` is the average of the fund's own umbrella category, such as the equity umbrella category for TI2, so it represents a different category for different funds.

TEFAS does not return every benchmark for every period; weekly queries, for example, omit deposit rates and inflation. Missing benchmarks are left out of the object. `fundReturn` is `null` when the fund's own row is missing. Unrecognized new benchmarks are ignored.

## Fund type

```ts
const type = await client.getFundType("AE1");

console.log(type); // "pension"
```

`getFundType` returns whether a fund is an investment fund (`"investment"`) or a pension fund (`"pension"`), or `null` when the fund is not found. This differs from the `kind` option of daily queries (`YAT`, `EMK`, and so on): `kind` is the query category you choose, while `getFundType` reports the type TEFAS assigns to the fund.

## Fund ranking and market summary

```ts
import { topFunds, summarizeMarket } from "tefas-js";

const largest = topFunds(snapshots, { by: "portfolioSize", limit: 10 });
const mostInvestors = topFunds(snapshots, { by: "investorCount", limit: 10 });
const summary = summarizeMarket(snapshots);
```

These functions use the supplied snapshots, send no requests, and leave the input unchanged. `topFunds` excludes null values in the selected field, sorts descending, and breaks ties by fund code. `limit` must be a positive integer.

`summarizeMarket` returns the fund count, total portfolio size, and sum of investor counts. Null values are excluded from totals. The investor total does not represent unique people; one person can hold several funds. Mixed kinds or dates produce `null` for the corresponding summary field. Empty input produces zero totals.

## Timeouts and cancellation

`timeoutMs` defaults to 10 seconds and covers requests, body reading, and retry waits within one query. It must be an integer from `1` to `2_147_483_647`.

```ts
const controller = new AbortController();
const pending = client.getPriceHistory("TI2", {
  periodMonths: 1,
  signal: controller.signal,
});

// From a cancel button or another application event:
controller.abort();

try {
  await pending;
} catch (error) {
  console.error(error);
}
```

User cancellation produces `ABORTED`; the client's own deadline produces `TIMEOUT`.

## Retry policy

Retries are disabled by default. Set `maxRetries` to `1` or `2` to opt in. Two retries mean at most three HTTP attempts.

Only network failures and HTTP `429`, `502`, `503`, and `504` are eligible. Access denials, invalid input, malformed data, source application errors, cancellation, and timeouts are not retried.

Backoff includes jitter. Supported `Retry-After` values are respected without shortening the requested wait. Unknown header formats or waits above 60 seconds stop automatic retries. The total query timeout still applies.

## Errors

```ts
import { TefasError } from "tefas-js";

try {
  await client.getPriceHistory("TI2", { periodMonths: 12 });
} catch (error) {
  if (error instanceof TefasError) {
    console.error(error.code, error.message);
  } else {
    throw error;
  }
}
```

Error codes: `INVALID_ARGUMENT`, `ACCESS_DENIED`, `HTTP_ERROR`, `SOURCE_ERROR`, `INVALID_RESPONSE`, `NETWORK_ERROR`, `TIMEOUT`, and `ABORTED`.

Additional information can include `status`, `sourceCode`, `retryAfterMs`, and the original `cause`. Branch on `code`, not message text.

## Development

Use the Bun version recorded in `package.json`.

Source code, tests, and development scripts are written in TypeScript. Node.js checks run the compiled JavaScript, while Bun tests run the TypeScript files directly. The npm package includes only the compiled library and its type declarations, along with the package metadata and documentation.

```sh
bun install --frozen-lockfile
bun run check
bun run verify:package
```

`check` builds the package and runs the same offline tests under Node.js and Bun. `verify:package` also inspects the tarball and tests a separate JavaScript/TypeScript consumer. It does not publish anything.

```sh
bun run smoke:live
bun run smoke:live -- TI2 2026-10-23
```

The live smoke checks all eight client methods with nine real requests. Checks wait at least 12 seconds apart; a 40-day history query uses two chunks with a 12-second interval. Allow about two minutes or more. Retries are disabled, and the suite stops at the first failure. It is not part of `check` or CI.

The first argument is the fund code (default `TI2`); the second is a reference date in `YYYY-MM-DD` format. Without a date, the previous weekday in Turkey's calendar is used. This suite checks investment funds using `YAT`. Holidays or unpublished data can produce empty results: choose a completed business day, as the script does not scan alternative dates. The history range covers 40 inclusive days ending on the reference date.

The CI matrix covers Node.js 22 and 24 on Linux and Windows. A configured matrix is separate from a successful CI run; check the repository's workflow results for the actual status.

## Rate limits

TEFAS may throttle or block clients that send many requests in a short time. `getDailyHistory` spaces out its own sequential chunks; there is no shared queue for other calls. When fetching several funds, send requests one at a time and keep them infrequent. A rejected or throttled request surfaces as `ACCESS_DENIED` or `HTTP_ERROR`, and retries stay disabled unless you opt in.

The client does not imitate a browser or try to bypass access controls. If TEFAS blocks a request, the error is reported instead of worked around.

## Scope

Fund listing, search, price history, daily snapshots, daily history over date ranges, asset allocation, return comparisons, and fund types are available, along with local ranking and summary helpers. Caching is future work. CommonJS and browser compatibility are not claimed.

No requests run during package installation or import. Client methods send requests; `searchFunds`, `topFunds`, and `summarizeMarket` run locally.

## Release notes

### 0.2.0 — in development

Added `getDailyHistory` for rate-limited daily history over date ranges.

Added `getComparison` for return comparisons and `getFundType` for fund types.

Added `getAllocation` for fund asset allocation.

Added `getSnapshot` and `getSnapshots` for daily fund data, and `topFunds` and `summarizeMarket` for local ranking and summaries.

Added `listFunds` for fund listings and founder information, and `searchFunds` for local search.

Added the `period` option for weekly and YTD queries. Existing `periodMonths` calls continue to work.

`PriceHistory.periodMonths` is now `HistoryPeriodMonths | null`. TypeScript consumers may need a null check when using this field. Results also include the required `period` field.

These changes have not been published to npm yet. Use `periodMonths` with the published `0.1.1` version.

## License and affiliation

MIT. See [LICENSE](LICENSE).

This project is not affiliated with or endorsed by TEFAS. The code license does not grant rights to TEFAS data or establish permission to access the source service.
