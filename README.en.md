# tefas-js

[English](README.en.md) | [Türkçe](README.md)

An unofficial TEFAS price history client for JavaScript and TypeScript.

Fetch one fund's historical prices through a small ESM API, with validated responses, typed results, cancellation, and optional bounded retries. No runtime dependencies.

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

## Asset allocation

```ts
const allocation = await client.getAllocation("TI2", { date: "2026-10-20" });

console.log(allocation?.weights.stock);
console.log(allocation?.weights.reverseRepo);
```

`getAllocation` returns the fund's allocation for the requested date. It accepts the same `kind` and `signal` options as daily snapshots. Filtering happens on the server; calls do not download allocations for all funds. An empty result returns `null`.

`weights` contains percentages: `92.28` means 92.28%. Missing or null entries are omitted, and zero is preserved. Values must be between 0 and 100; totals may differ from 100 by at most 0.5 percentage points. Conflicting rows, unexpected fund codes, and unexpected dates are rejected.

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

`bun run smoke:live` sends one real request to TEFAS for `TI2`. Pass another fund code after `--`. It is not part of `check` or CI.

The CI matrix covers Node.js 22 and 24 on Linux and Windows. A configured matrix is separate from a successful CI run; check the repository's workflow results for the actual status.

## Rate limits

TEFAS does not document its API and may throttle or block clients that send many requests in a short time. This package does not queue or space out requests for you. When fetching several funds, send requests one at a time and keep them infrequent. A rejected or throttled request surfaces as `ACCESS_DENIED` or `HTTP_ERROR`, and retries stay disabled unless you opt in.

The client does not imitate a browser or try to bypass access controls. If TEFAS blocks a request, the error is reported instead of worked around.

## Scope

Fund listing, search, price history, daily snapshots, and asset allocation are available, along with local ranking and summary helpers. Daily history over date ranges and caching are future work. CommonJS and browser compatibility are not claimed.

No requests run during package installation or import. Client methods send requests; `searchFunds`, `topFunds`, and `summarizeMarket` run locally.

## Release notes

### 0.2.0 — in development

Added `getAllocation` for fund asset allocation.

Added `getSnapshot` and `getSnapshots` for daily fund data, and `topFunds` and `summarizeMarket` for local ranking and summaries.

Added `listFunds` for fund listings and founder information, and `searchFunds` for local search.

Added the `period` option for weekly and YTD queries. Existing `periodMonths` calls continue to work.

`PriceHistory.periodMonths` is now `HistoryPeriodMonths | null`. TypeScript consumers may need a null check when using this field. Results also include the required `period` field.

These changes have not been published to npm yet. Use `periodMonths` with the published `0.1.1` version.

## License and affiliation

MIT. See [LICENSE](LICENSE).

This project is not affiliated with or endorsed by TEFAS. The code license does not grant rights to TEFAS data or establish permission to access the source service.
