import { TefasError } from "./errors.js";
import type { HistoryPeriodMonths } from "./types.js";

const PRICE_HISTORY_URL = "https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export async function requestPriceHistory(
  fundCode: string,
  periodMonths: HistoryPeriodMonths,
  fetcher: Fetcher = globalThis.fetch,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetcher(PRICE_HISTORY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        fonKodu: fundCode,
        dil: "TR",
        periyod: periodMonths,
      }),
    });
  } catch (cause) {
    throw new TefasError("NETWORK_ERROR", "Could not reach the data source.", { cause });
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);

    const code = response.status === 401 || response.status === 403 ? "ACCESS_DENIED" : "HTTP_ERROR";

    throw new TefasError(code, "The data source rejected the HTTP request", { status: response.status });
  }

  let text: string;

  try {
    text = await response.text();
  } catch (cause) {
    throw new TefasError("NETWORK_ERROR", "Could not read the response body", { status: response.status, cause });
  }

  try {
    const payload: unknown = JSON.parse(text);
    return payload;
  } catch (cause) {
    throw new TefasError("INVALID_RESPONSE", "The response is not valid JSON.", { status: response.status, cause });
  }
}
