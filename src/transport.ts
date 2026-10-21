import { TefasError } from "./errors.js";
import { parseRetryAfter } from "./retry.js";
import type { HistoryPeriodMonths } from "./types.js";

const PRICE_HISTORY_URL = "https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export async function requestPriceHistory(
  fundCode: string,
  periodMonths: HistoryPeriodMonths,
  fetcher: Fetcher = globalThis.fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  return postJson(PRICE_HISTORY_URL, { fonKodu: fundCode, dil: "TR", periyod: periodMonths }, fetcher, signal);
}

export async function postJson(
  url: string,
  body: Readonly<Record<string, unknown>>,
  fetcher: Fetcher = globalThis.fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  let response: Response;

  try {
    response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause) {
    throw new TefasError("NETWORK_ERROR", "Could not reach the data source.", { cause });
  }

  signal?.throwIfAborted();

  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);

    const code = response.status === 401 || response.status === 403 ? "ACCESS_DENIED" : "HTTP_ERROR";
    const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));

    throw new TefasError(code, "The data source rejected the HTTP request.", {
      status: response.status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }

  let text: string;

  try {
    text = await response.text();
  } catch (cause) {
    throw new TefasError("NETWORK_ERROR", "Could not read the response body.", {
      status: response.status,
      cause,
    });
  }

  signal?.throwIfAborted();

  try {
    const payload: unknown = JSON.parse(text);
    return payload;
  } catch (cause) {
    const contentType = response.headers.get("Content-Type")?.trim().toLowerCase();
    const accessDenied = contentType?.startsWith("text/html") === true ||
      /The requested URL was rejected|Erişim Engellendi|Web Application Firewall/iu.test(text);
    throw new TefasError(accessDenied ? "ACCESS_DENIED" : "INVALID_RESPONSE", accessDenied ? "The data source denied access." : "The response is not valid JSON.", {
      status: response.status,
      cause,
    });
  }
}
