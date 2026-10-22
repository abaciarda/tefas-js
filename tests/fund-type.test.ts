import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TefasClient } from "../dist/index.js";
import type { GetFundTypeOptions } from "../dist/index.js";
import { parseFundType } from "../dist/fund-type.js";
import { isRecord } from "../dist/validation.js";
import { matchesCode, pendingFetch, withFetch } from "./helpers.js";

const typed = (fonTipi: unknown, extra: Record<string, unknown> = {}) => ({ errorCode: null, errorMessage: null, fonTipi, ...extra });
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}.json`, import.meta.url), "utf8"));

test("fund type requests send the normalized code and map the live investment fixture", async () => {
  const payload = fixture("fonTipiGetir");
  const original = structuredClone(payload);
  let calls = 0;
  await withFetch(async (url, init) => {
    calls += 1;
    assert.equal(url, "https://www.tefas.gov.tr/api/funds/fonTipiGetir");
    assert.equal(init.method, "POST");
    assert.deepEqual(Object.fromEntries(new Headers(init.headers)), { accept: "application/json", "content-type": "application/json" });
    assert.deepEqual(JSON.parse(init.body), { fonKodu: "TI2" });
    return Response.json(payload);
  }, async () => {
    assert.equal(await new TefasClient().getFundType(" ti2 "), "investment");
  });
  assert.equal(calls, 1);
  assert.deepEqual(payload, original);
});

test("the live pension and missing-fund fixtures map to pension and null", () => {
  assert.equal(parseFundType(fixture("fonTipiGetir-pension")), "pension");
  const missing = fixture("fonTipiGetir-missing");
  const original = structuredClone(missing);
  assert.equal(parseFundType(missing), null);
  assert.deepEqual(missing, original);
});

test("empty successful fund types return null", () => {
  assert.equal(parseFundType(typed(null)), null);
  assert.equal(parseFundType(typed("")), null);
});

test("unknown fund types and malformed envelopes are invalid responses", () => {
  for (const payload of [typed("f"), typed("m"), typed("X"), typed("YAT"), typed("EMK"), typed(1), typed(false), typed({}),
    { errorCode: null, errorMessage: null }, null, [], {}]) {
    assert.throws(() => parseFundType(payload), matchesCode("INVALID_RESPONSE"));
  }
});

test("source errors other than the observed missing-fund response are not hidden", () => {
  const missing = fixture("fonTipiGetir-missing");
  assert.ok(isRecord(missing));
  for (const extra of [{ errorCode: 7 }, { errorMessage: "Index 1 out of bounds for length 0" }, { fonTipi: "F" }, { fonTipi: "" }]) {
    assert.throws(() => parseFundType({ ...missing, ...extra }), matchesCode("SOURCE_ERROR"));
  }
  assert.throws(
    () => parseFundType(typed(null, { errorCode: "E1", errorMessage: "Failure" })),
    (error) => matchesCode("SOURCE_ERROR")(error) && error.sourceCode === "E1",
  );
});

test("invalid fund type arguments never send requests", async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; return Response.json(typed("F")); }, async () => {
    const client = new TefasClient();
    for (const value of [null, [], { signal: {} }, { kind: "YAT" }, { typo: true }]) {
      await assert.rejects(() => client.getFundType("TI2", value as GetFundTypeOptions), matchesCode("INVALID_ARGUMENT"));
    }
    for (const code of [null, 123, "", "LONG", "TI-2"]) {
      await assert.rejects(() => client.getFundType(code as string), matchesCode("INVALID_ARGUMENT"));
    }
  });
  assert.equal(calls, 0);
});

test("fund type requests share bounded retry, timeout and cancellation behavior", async () => {
  let attempts = 0;
  await withFetch(async () => {
    attempts += 1;
    return attempts === 1 ? new Response("Unavailable", { status: 503 }) : Response.json(typed("M"));
  }, async () => {
    assert.equal(await new TefasClient({ maxRetries: 1 }).getFundType("AE1", {}), "pension");
  });
  assert.equal(attempts, 2);
  let deniedCalls = 0;
  await withFetch(async () => {
    deniedCalls += 1;
    return new Response("Web Application Firewall");
  }, async () => {
    await assert.rejects(() => new TefasClient({ maxRetries: 2 }).getFundType("TI2"), matchesCode("ACCESS_DENIED"));
  });
  assert.equal(deniedCalls, 1);
  await withFetch(pendingFetch, async () => {
    await assert.rejects(() => new TefasClient({ timeoutMs: 20 }).getFundType("TI2"), matchesCode("TIMEOUT"));
    const controller = new AbortController();
    const reason = new Error("Stop fund type");
    const running = new TefasClient().getFundType("TI2", { signal: controller.signal });
    const check = assert.rejects(running, (error) => matchesCode("ABORTED")(error) && error.cause === reason);
    controller.abort(reason);
    await check;
  });
  const controller = new AbortController();
  controller.abort();
  await withFetch(async () => { assert.fail("Cancelled fund type requests must not send requests"); }, async () => {
    await assert.rejects(() => new TefasClient().getFundType("TI2", { signal: controller.signal }), matchesCode("ABORTED"));
  });
});
