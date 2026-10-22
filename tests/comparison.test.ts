import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TefasClient } from "../dist/index.js";
import type { GetComparisonOptions, HistoryPeriod } from "../dist/index.js";
import { parseComparison } from "../dist/comparison.js";
import { isRecord } from "../dist/validation.js";
import { envelope, matchesCode, pendingFetch, withFetch } from "./helpers.js";

const row = (fonKodu: string, fonTuru: unknown, fonTurGetiri: unknown, extra: Record<string, unknown> = {}) => ({
  fonKodu, fonUnvan: fonKodu, fonTuru, fonTurGetiri, ...extra,
});
const fundRow = (value: unknown) => row("TI2", "Hisse Senedi Şemsiye Fonu", value, { fonUnvan: "İŞ PORTFÖY" });
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}.json`, import.meta.url), "utf8"));

test("comparison requests send the profile body and map the full live one-year fixture as ratios", async () => {
  const payload = fixture("fonProfilDtyGetir");
  const original = structuredClone(payload);
  let calls = 0;
  await withFetch(async (url, init) => {
    calls += 1;
    assert.equal(url, "https://www.tefas.gov.tr/api/funds/fonProfilDtyGetir");
    assert.equal(init.method, "POST");
    assert.deepEqual(Object.fromEntries(new Headers(init.headers)), { accept: "application/json", "content-type": "application/json" });
    assert.deepEqual(JSON.parse(init.body), { fonKodu: "TI2", dil: "TR", periyod: 12 });
    return Response.json(payload);
  }, async () => {
    assert.deepEqual(await new TefasClient().getComparison(" ti2 ", { period: "1y" }), {
      fundCode: "TI2",
      period: "1y",
      fundReturn: 0.116586,
      benchmarks: {
        gold: 0.108125, bist100: 0.097218, bist30: 0.259047, eur: 0.14167, usd: 0.182039,
        depositRate: 0.4054, umbrellaCategory: 0.1628, inflation: 0.297315,
      },
    });
  });
  assert.equal(calls, 1);
  assert.deepEqual(payload, original);
});

test("the weekly fund return is a ratio that matches the same-week price history", () => {
  const comparison = parseComparison(fixture("fonProfilDtyGetir-week"), "TI2", "1w");
  const history = fixture("fonFiyatBilgiGetir-week-full");
  assert.ok(isRecord(history) && Array.isArray(history.resultList));
  const prices: unknown[] = history.resultList;
  const first = prices[0];
  const last = prices[prices.length - 1];
  assert.ok(isRecord(first) && typeof first.fiyat === "number");
  assert.ok(isRecord(last) && typeof last.fiyat === "number");
  assert.equal(comparison.fundReturn, -0.039812);
  assert.equal(Number((last.fiyat / first.fiyat - 1).toFixed(6)), comparison.fundReturn);
  assert.deepEqual(comparison.benchmarks, {
    gold: 0.001026, bist100: -0.040849, bist30: -0.034907, eur: 0.006788, usd: 0.004223, umbrellaCategory: -0.0426,
  });
});

test("every comparison period is sent as its source period", async () => {
  const expected: readonly (readonly [HistoryPeriod, number])[] = [
    ["1w", 13], ["1m", 1], ["3m", 3], ["6m", 6], ["ytd", 0], ["1y", 12], ["3y", 36], ["5y", 60],
  ];
  for (const [period, periyod] of expected) {
    await withFetch(async (_url, init) => {
      assert.deepEqual(JSON.parse(init.body), { fonKodu: "TI2", dil: "TR", periyod });
      return Response.json(envelope([fundRow(0.1)]));
    }, async () => {
      assert.equal((await new TefasClient().getComparison("TI2", { period })).period, period);
    });
  }
});

test("zero and negative returns are kept while missing rows stay absent", () => {
  assert.deepEqual(parseComparison(envelope([fundRow(0), row("BIST30", "BIST30", -0.25), row("ALTIN", "ALTIN", 0)]), "TI2", "1m"), {
    fundCode: "TI2", period: "1m", fundReturn: 0, benchmarks: { bist30: -0.25, gold: 0 },
  });
  assert.deepEqual(parseComparison(envelope([row("USD", "USD", 0.01)]), "TI2", "1m"), {
    fundCode: "TI2", period: "1m", fundReturn: null, benchmarks: { usd: 0.01 },
  });
  assert.deepEqual(parseComparison(envelope([]), "TI2", "ytd"), { fundCode: "TI2", period: "ytd", fundReturn: null, benchmarks: {} });
});

test("unknown comparison rows are ignored without hiding malformed known rows", () => {
  const payload = envelope([fundRow(0.1), row("YENI ENDEKS", "YENI", "not-a-number"), row("ALTIN", "ALTIN", 0.2)]);
  const original = structuredClone(payload);
  const comparison = parseComparison(payload, "TI2", "1y");
  assert.deepEqual(comparison.benchmarks, { gold: 0.2 });
  assert.equal("raw" in comparison, false);
  assert.deepEqual(payload, original);
  for (const value of [NaN, Infinity, -Infinity, "0.1", null, undefined, {}, false]) {
    assert.throws(() => parseComparison(envelope([row("ALTIN", "ALTIN", value)]), "TI2", "1y"), matchesCode("INVALID_RESPONSE"));
    assert.throws(() => parseComparison(envelope([fundRow(value)]), "TI2", "1y"), matchesCode("INVALID_RESPONSE"));
    assert.throws(
      () => parseComparison(envelope([row("HISSE SENEDI ŞEMSIYE FONU", "Hisse Senedi Şemsiye Fonu", value)]), "TI2", "1y"),
      matchesCode("INVALID_RESPONSE"),
    );
  }
});

test("malformed rows, mismatched benchmark types and other funds are rejected", () => {
  for (const entry of [null, [], {}, row("", "ALTIN", 0.1), row("ALTIN", "", 0.1), row("ALTIN", 7, 0.1), row("ALTIN", "BIST30", 0.1),
    row("MEVDUAT FAIZI", "MEVDUAT FAIZI", 0.1), row("AAA", "Hisse Senedi Şemsiye Fonu", 0.1), row("TI3", "Hisse Senedi Şemsiye Fonu", 0.1)]) {
    assert.throws(() => parseComparison(envelope([entry]), "TI2", "1y"), matchesCode("INVALID_RESPONSE"));
  }
});

test("duplicate comparison rows deduplicate equal values and reject conflicts", () => {
  assert.deepEqual(parseComparison(envelope([fundRow(0.1), fundRow(0.1), row("EUR", "EUR", 0.2), row("EUR", "EUR", 0.2)]), "TI2", "1y"), {
    fundCode: "TI2", period: "1y", fundReturn: 0.1, benchmarks: { eur: 0.2 },
  });
  for (const rows of [
    [fundRow(0.1), fundRow(0.2)],
    [row("EUR", "EUR", 0.2), row("EUR", "EUR", 0.3)],
    [row("A ŞEMSIYE FONU", "A Şemsiye Fonu", 0.1), row("B ŞEMSIYE FONU", "B Şemsiye Fonu", 0.2)],
  ]) {
    assert.throws(() => parseComparison(envelope(rows), "TI2", "1y"), matchesCode("INVALID_RESPONSE"));
  }
});

test("broken comparison envelopes and source errors keep their codes", () => {
  for (const payload of [null, [], {}, envelope(null), envelope({}), envelope([], { errorCode: undefined })]) {
    assert.throws(() => parseComparison(payload, "TI2", "1y"), matchesCode("INVALID_RESPONSE"));
  }
  for (const payload of [envelope(null, { errorMessage: "Index 0 out of bounds for length 0" }), envelope([], { errorCode: 7 })]) {
    assert.throws(() => parseComparison(payload, "TI2", "1y"), matchesCode("SOURCE_ERROR"));
  }
});

test("invalid comparison arguments never send requests", async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; return Response.json(envelope()); }, async () => {
    const client = new TefasClient();
    for (const value of [null, undefined, [], {}, { period: "12m" }, { period: 12 }, { periodMonths: 12 },
      { period: "1y", periodMonths: 12 }, { period: "1y", kind: "YAT" }, { period: "1y", signal: {} }]) {
      await assert.rejects(() => client.getComparison("TI2", value as GetComparisonOptions), matchesCode("INVALID_ARGUMENT"));
    }
    for (const code of [null, 123, "", "LONG", "TI-2"]) {
      await assert.rejects(() => client.getComparison(code as string, { period: "1y" }), matchesCode("INVALID_ARGUMENT"));
    }
  });
  assert.equal(calls, 0);
});

test("comparison requests share bounded retry, timeout and cancellation behavior", async () => {
  let attempts = 0;
  await withFetch(async () => {
    attempts += 1;
    return attempts === 1 ? new Response("Unavailable", { status: 503 }) : Response.json(envelope([fundRow(0.1)]));
  }, async () => {
    assert.equal((await new TefasClient({ maxRetries: 1 }).getComparison("TI2", { period: "1y" })).fundReturn, 0.1);
  });
  assert.equal(attempts, 2);
  let deniedCalls = 0;
  await withFetch(async () => {
    deniedCalls += 1;
    return new Response("Web Application Firewall");
  }, async () => {
    await assert.rejects(() => new TefasClient({ maxRetries: 2 }).getComparison("TI2", { period: "1y" }), matchesCode("ACCESS_DENIED"));
  });
  assert.equal(deniedCalls, 1);
  await withFetch(pendingFetch, async () => {
    await assert.rejects(() => new TefasClient({ timeoutMs: 20 }).getComparison("TI2", { period: "1y" }), matchesCode("TIMEOUT"));
    const controller = new AbortController();
    const reason = new Error("Stop comparison");
    const running = new TefasClient().getComparison("TI2", { period: "1y", signal: controller.signal });
    const check = assert.rejects(running, (error) => matchesCode("ABORTED")(error) && error.cause === reason);
    controller.abort(reason);
    await check;
  });
  const controller = new AbortController();
  controller.abort();
  await withFetch(async () => { assert.fail("Cancelled comparisons must not send requests"); }, async () => {
    await assert.rejects(() => new TefasClient().getComparison("TI2", { period: "1y", signal: controller.signal }), matchesCode("ABORTED"));
  });
});
