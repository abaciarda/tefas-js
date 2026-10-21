import test from "node:test";
import assert from "node:assert/strict";
import { requestPriceHistory } from "../dist/transport.js";
import { matchesCode } from "./helpers.js";

test("transport sends the expected JSON request once", async () => {
  let calls = 0;
  const result = await requestPriceHistory("TI2", 12, async (url, init) => {
    calls += 1;
    assert.equal(url, "https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir");
    assert.equal(init.method, "POST");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(headers.get("Accept"), "application/json");
    assert.ok(typeof init.body === "string");
    assert.deepEqual(JSON.parse(init.body), { fonKodu: "TI2", dil: "TR", periyod: 12 });
    return Response.json({ arbitrary: true });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { arbitrary: true });
});

test("HTTP errors keep status and Retry-After metadata", async () => {
  for (const status of [401, 403, 429, 500, 502, 503, 504]) {
    const code = status === 401 || status === 403 ? "ACCESS_DENIED" : "HTTP_ERROR";
    await assert.rejects(
      () =>
        requestPriceHistory(
          "TI2",
          1,
          async () =>
            new Response("Failure", {
              status,
              headers: { "Retry-After": "2" },
            }),
        ),
      (error) => matchesCode(code)(error) && error.status === status && error.retryAfterMs === 2000,
    );
  }
});

test("connection and body failures preserve their causes", async () => {
  const cause = new Error("Connection interrupted");
  await assert.rejects(
    () =>
      requestPriceHistory("TI2", 1, async () => {
        throw cause;
      }),
    (error) => matchesCode("NETWORK_ERROR")(error) && error.cause === cause,
  );
  await assert.rejects(
    () =>
      requestPriceHistory(
        "TI2",
        1,
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(cause);
              },
            }),
          ),
      ),
    (error) => matchesCode("NETWORK_ERROR")(error) && error.status === 200 && error.cause === cause,
  );
});

test("HTML and broken JSON are not valid JSON responses", async () => {
  for (const body of ["<html>Unexpected page</html>", "{broken"]) {
    await assert.rejects(
      () => requestPriceHistory("TI2", 1, async () => new Response(body)),
      matchesCode("INVALID_RESPONSE"),
    );
  }
});
