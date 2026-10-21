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

The first version focuses on one fund's price history. Fund discovery, additional fund details, multi-fund queries, and caching are future work. CommonJS and browser compatibility are not claimed.

No requests run during package installation or import. TEFAS is queried when you call the client method.

## Release notes

### 0.2.0 — in development

Added the `period` option for weekly and YTD queries. Existing `periodMonths` calls continue to work.

`PriceHistory.periodMonths` is now `HistoryPeriodMonths | null`. TypeScript consumers may need a null check when using this field. Results also include the required `period` field.

These changes have not been published to npm yet. Use `periodMonths` with the published `0.1.1` version.

## License and affiliation

MIT. See [LICENSE](LICENSE).

This project is not affiliated with or endorsed by TEFAS. The code license does not grant rights to TEFAS data or establish permission to access the source service.
