import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TefasClient } from "../dist/index.js";
import type { GetSnapshotsOptions } from "../dist/index.js";
import { parseAllocation } from "../dist/allocation.js";
import { isRecord } from "../dist/validation.js";
import { envelope, matchesCode, pendingFetch, withFetch } from "./helpers.js";

const date = "2026-10-20";
const row = (extra: Record<string, unknown> = {}) => ({ fonKodu: "TI2", fonUnvan: " İŞ PORTFÖY ", tarih: date, hs: 100, ...extra });
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}.json`, import.meta.url), "utf8"));

test("allocation requests use the first verified filter and map the live TI2 fixture", async () => {
  const payload = fixture("dagilimSiraliGetirT-both-codes");
  const original = structuredClone(payload);
  let calls = 0;
  await withFetch(async (url, init) => {
    calls += 1;
    assert.equal(url, "https://www.tefas.gov.tr/api/funds/dagilimSiraliGetirT");
    assert.equal(init.method, "POST");
    assert.deepEqual(Object.fromEntries(new Headers(init.headers)), { accept: "application/json", "content-type": "application/json" });
    assert.deepEqual(JSON.parse(init.body), {
      fonTipi: "YAT", fonKodu: "TI2", aramaMetni: null, fonTurKod: null,
      fonGrubu: null, sfonTurKod: null, fonTurAciklama: null, kurucuKod: null,
      basTarih: "20261020", bitTarih: "20261020", basSira: 1, bitSira: 100000,
      dil: "TR", sFonTurKod: "", fonKod: "TI2", fonGrup: "", fonUnvanTip: "",
    });
    return Response.json(payload);
  }, async () => {
    assert.deepEqual(await new TefasClient().getAllocation(" ti2 ", { date }), {
      fundCode: "TI2", fundName: "İŞ PORTFÖY HİSSE SENEDİ (TL) FONU (HİSSE SENEDİ YOĞUN FON)", kind: "YAT", date,
      weights: { stock: 92.28, reverseRepo: 2.15, investmentFund: 2.2, futuresCashCollateral: 3.37 },
    });
  });
  assert.equal(calls, 1);
  assert.deepEqual(payload, original);
});

test("all three discovery filter fixtures describe the same single-fund allocation", () => {
  const expected = parseAllocation(fixture("dagilimSiraliGetirT-both-codes"), "TI2", "YAT", date);
  assert.ok(expected);
  for (const name of ["dagilimSiraliGetirT-fonKod-only", "dagilimSiraliGetirT-search"]) {
    assert.deepEqual(parseAllocation(fixture(name), "TI2", "YAT", date), expected);
  }
});

test("other discovered allocations retain the observed 100-percent totals", () => {
  const payload = fixture("dagilimSiraliGetirT");
  assert.ok(isRecord(payload));
  assert.ok(Array.isArray(payload.resultList));
  const rows: unknown[] = payload.resultList;
  for (const entry of rows) {
    assert.ok(isRecord(entry));
    assert.ok(typeof entry.fonKodu === "string");
    const allocation = parseAllocation(envelope([entry]), entry.fonKodu, "YAT", date);
    assert.ok(allocation);
    const total = Object.values(allocation.weights).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 100) < 1e-9);
    assert.equal("bilFiyat" in allocation.weights, false);
    assert.equal("raw" in allocation, false);
    if (entry.fonKodu === "AAL") {
      assert.equal(allocation.weights.governmentBond, 10.18);
      assert.equal(allocation.weights.financingBill, 9.17);
      assert.equal(allocation.weights.treasuryBill, 3.99);
      assert.equal(allocation.weights.depositTl, 22.92);
    }
  }
});

test("allocation weights omit missing and null entries while retaining zero", () => {
  const payload = envelope([row({ dt: 0, bb: null, hb: undefined, bilFiyat: "metadata", unknownField: "ignored" })]);
  const original = structuredClone(payload);
  assert.deepEqual(parseAllocation(payload, "TI2", "YAT", date)?.weights, { stock: 100, governmentBond: 0 });
  assert.deepEqual(payload, original);
});

test("percentage validation enforces finite bounds and the half-point total tolerance", () => {
  for (const extra of [{ hs: 99.5 }, { hs: 99.3, tr: 0.2 }, { hs: 100, tr: 0.5 }]) {
    assert.ok(parseAllocation(envelope([row(extra)]), "TI2", "YAT", date));
  }
  for (const extra of [{ hs: 99.4999 }, { hs: 100, tr: 0.5001 }, { hs: 50 }, { hs: 0 }, { hs: null }, { hs: undefined }]) {
    assert.throws(() => parseAllocation(envelope([row(extra)]), "TI2", "YAT", date), matchesCode("INVALID_RESPONSE"));
  }
  for (const value of [-1, 100.01, NaN, Infinity, "100", false, {}, []]) {
    assert.throws(() => parseAllocation(envelope([row({ hs: value })]), "TI2", "YAT", date), matchesCode("INVALID_RESPONSE"));
  }
});

test("malformed allocation rows and unexpected funds or dates are rejected", () => {
  for (const entry of [null, [], {}, row({ fonKodu: "AAA" }), row({ fonKodu: "ti2" }), row({ fonUnvan: " " }),
    row({ tarih: "2026-02-30" }), row({ tarih: "2026-10-19" }), row({ tarih: "2026-10-20T00:00:00Z" })]) {
    assert.throws(() => parseAllocation(envelope([entry]), "TI2", "YAT", date), matchesCode("INVALID_RESPONSE"));
  }
  assert.throws(() => parseAllocation(envelope([row(), row({ fonKodu: "AAA" })]), "TI2", "YAT", date), matchesCode("INVALID_RESPONSE"));
});

test("duplicate allocations must agree on the name and every included weight", () => {
  assert.deepEqual(parseAllocation(envelope([row(), row({ bilFiyat: "changed metadata" })]), "TI2", "YAT", date)?.weights, { stock: 100 });
  for (const extra of [{ fonUnvan: "Other Fund" }, { hs: 99, tr: 1 }, { dt: 0 }]) {
    assert.throws(() => parseAllocation(envelope([row(), row(extra)]), "TI2", "YAT", date), matchesCode("INVALID_RESPONSE"));
  }
});

test("empty allocation results return null and other envelopes keep their errors", async () => {
  await withFetch(async () => Response.json(envelope()), async () => {
    assert.equal(await new TefasClient().getAllocation("TI2", { date }), null);
  });
  for (const payload of [null, [], {}, envelope(null), envelope({})]) {
    assert.throws(() => parseAllocation(payload, "TI2", "YAT", date), matchesCode("INVALID_RESPONSE"));
  }
  assert.throws(
    () => parseAllocation(envelope(null, { errorCode: 7, errorMessage: "Failure" }), "TI2", "YAT", date),
    (error) => matchesCode("SOURCE_ERROR")(error) && error.sourceCode === 7,
  );
});

test("the observed weekend allocation response returns null without hiding other source errors", async () => {
  const payload = fixture("dagilimSiraliGetirT-weekend");
  assert.ok(isRecord(payload));
  let calls = 0;
  await withFetch(async (_url, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    assert.equal(body.basTarih, "20261018");
    assert.equal(body.bitTarih, "20261018");
    return Response.json(payload);
  }, async () => {
    assert.equal(await new TefasClient({ maxRetries: 2 }).getAllocation("TI2", { date: "2026-10-18" }), null);
  });
  assert.equal(calls, 1);
  for (const extra of [{ errorCode: 7 }, { errorMessage: "Index 1 out of bounds for length 0" }, { resultList: [] }]) {
    assert.throws(() => parseAllocation({ ...payload, ...extra }, "TI2", "YAT", "2026-10-18"), matchesCode("SOURCE_ERROR"));
  }
});

test("invalid allocation arguments never send requests", async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; return Response.json(envelope()); }, async () => {
    const client = new TefasClient();
    for (const value of [null, undefined, [], {}, { date: "2026-02-30" }, { date, kind: "F" }, { date, kind: null },
      { date, signal: {} }, { date, typo: true }]) {
      await assert.rejects(() => client.getAllocation("TI2", value as GetSnapshotsOptions), matchesCode("INVALID_ARGUMENT"));
    }
    for (const code of [null, 123, "", "LONG", "TI-2"]) {
      await assert.rejects(() => client.getAllocation(code as string, { date }), matchesCode("INVALID_ARGUMENT"));
    }
  });
  assert.equal(calls, 0);
});

test("allocation requests preserve the selected fund kind", async () => {
  for (const kind of ["YAT", "EMK", "BYF", "GYF", "GSYF"] as const) {
    await withFetch(async (_url, init) => {
      assert.equal(JSON.parse(init.body).fonTipi, kind);
      return Response.json(envelope([row()]));
    }, async () => {
      assert.equal((await new TefasClient().getAllocation("TI2", { date, kind }))?.kind, kind);
    });
  }
});

test("allocation requests share bounded retry, timeout and cancellation behavior", async () => {
  let attempts = 0;
  await withFetch(async () => {
    attempts += 1;
    return attempts === 1 ? new Response("Unavailable", { status: 503 }) : Response.json(envelope([row()]));
  }, async () => {
    assert.equal((await new TefasClient({ maxRetries: 1 }).getAllocation("TI2", { date }))?.weights.stock, 100);
  });
  assert.equal(attempts, 2);
  let deniedCalls = 0;
  await withFetch(async () => {
    deniedCalls += 1;
    return new Response("Web Application Firewall");
  }, async () => {
    await assert.rejects(() => new TefasClient({ maxRetries: 2 }).getAllocation("TI2", { date }), matchesCode("ACCESS_DENIED"));
  });
  assert.equal(deniedCalls, 1);
  await withFetch(pendingFetch, async () => {
    await assert.rejects(() => new TefasClient({ timeoutMs: 20 }).getAllocation("TI2", { date }), matchesCode("TIMEOUT"));
    const controller = new AbortController();
    const reason = new Error("Stop allocation");
    const running = new TefasClient().getAllocation("TI2", { date, signal: controller.signal });
    const check = assert.rejects(running, (error) => matchesCode("ABORTED")(error) && error.cause === reason);
    controller.abort(reason);
    await check;
  });
  const controller = new AbortController();
  controller.abort();
  await withFetch(async () => { assert.fail("Cancelled allocations must not send requests"); }, async () => {
    await assert.rejects(() => new TefasClient().getAllocation("TI2", { date, signal: controller.signal }), matchesCode("ABORTED"));
  });
});
