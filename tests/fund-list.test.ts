import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TefasClient } from "../dist/index.js";
import { parseFundListings } from "../dist/fund-list.js";
import { matchesCode, pendingFetch, withFetch } from "./helpers.js";

const listing = (data: unknown = [], extra: Record<string, unknown> = {}) => ({
  errorCode: null, errorMessage: null, error: false, data, ...extra,
});

test("fund listing uses the discovered endpoint and maps founder fields from the fixture", async () => {
  const fixture: unknown = JSON.parse(readFileSync(new URL("../tests/fixtures/getFplFonList.json", import.meta.url), "utf8"));
  const original = structuredClone(fixture);
  let calls = 0;
  await withFetch(async (url, init) => {
    calls += 1;
    assert.equal(url, "https://www.tefas.gov.tr/api/statistics/tefas/getFplFonList");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), {});
    assert.deepEqual(Object.fromEntries(new Headers(init.headers)), {
      accept: "application/json", "content-type": "application/json",
    });
    return Response.json(fixture);
  }, async () => {
    const funds = await new TefasClient().listFunds();
    assert.deepEqual(funds.map((fund) => fund.fundCode), ["AAL", "AAS", "AAV"]);
    assert.deepEqual(funds[0], {
      fundCode: "AAL", fundName: "ATA PORTFÖY PARA PİYASASI (TL) FONU",
      founderCode: "APY", founderName: "ATA PORTFÖY YÖNETİMİ A.Ş.",
    });
    assert.equal(calls, 1);
  });
  assert.deepEqual(fixture, original);
});

test("fund listings are sorted and deduplicated without changing input or inventing founder values", () => {
  const payload = listing([
    { fonKod: "TI2", unvan: " İŞ PORTFÖY " },
    { fonKod: "AAL", unvan: "ATA PORTFÖY", kurucuKod: null, kurucuAd: null },
    { fonKod: "TI2", unvan: "İŞ PORTFÖY", kurucuKod: null },
  ]);
  const original = structuredClone(payload);
  assert.deepEqual(parseFundListings(payload), [
    { fundCode: "AAL", fundName: "ATA PORTFÖY", founderCode: null, founderName: null },
    { fundCode: "TI2", fundName: "İŞ PORTFÖY", founderCode: null, founderName: null },
  ]);
  assert.deepEqual(payload, original);
  assert.deepEqual(parseFundListings(listing()), []);
});

test("invalid list envelopes and source errors are reported without coercion", () => {
  for (const payload of [null, [], {}, listing(null), listing({}), listing([], { error: "false" }), listing([], { error: undefined })]) {
    assert.throws(() => parseFundListings(payload), matchesCode("INVALID_RESPONSE"));
  }
  assert.throws(() => parseFundListings(listing([], { error: true })), matchesCode("SOURCE_ERROR"));
  assert.throws(
    () => parseFundListings(listing([], { errorCode: 7, errorMessage: "Failure", error: true })),
    (error) => matchesCode("SOURCE_ERROR")(error) && error.sourceCode === 7,
  );
});

test("invalid fund list rows and founder field types are rejected", () => {
  for (const row of [
    null, [], {}, { fonKod: "ti2", unvan: "Fund" }, { fonKod: "TOOLONG", unvan: "Fund" },
    { fonKod: 123, unvan: "Fund" }, { fonKod: "TI2", unvan: " " }, { fonKod: "TI2", unvan: 5 },
    { fonKod: "TI2", unvan: "Fund", kurucuKod: 0 }, { fonKod: "TI2", unvan: "Fund", kurucuAd: false },
    { fonKod: "TI2", unvan: "Fund", kurucuKod: " " }, { fonKod: "TI2", unvan: "Fund", kurucuAd: [] },
  ]) {
    assert.throws(() => parseFundListings(listing([row])), matchesCode("INVALID_RESPONSE"));
  }
});

test("conflicting fund names or founder data for a repeated code are rejected", () => {
  for (const extra of [{ unvan: "Other Fund" }, { kurucuKod: "OTHER" }, { kurucuAd: "Other Founder" }]) {
    const row = { fonKod: "TI2", unvan: "Fund", kurucuKod: "IPY", kurucuAd: "İŞ PORTFÖY" };
    assert.throws(() => parseFundListings(listing([row, { ...row, ...extra }])), matchesCode("INVALID_RESPONSE"));
  }
});

test("invalid list options never send requests", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return Response.json(listing());
  }, async () => {
    const client = new TefasClient();
    for (const options of [null, [], 5, "", { typo: true }, { signal: {} }]) {
      await assert.rejects(
        () => client.listFunds(options as { readonly signal?: AbortSignal }),
        matchesCode("INVALID_ARGUMENT"),
      );
    }
  });
  assert.equal(calls, 0);
});

test("listing shares bounded retries, timeouts and user cancellation", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return calls === 1 ? new Response("Unavailable", { status: 503 }) : Response.json(listing());
  }, async () => {
    assert.deepEqual(await new TefasClient({ maxRetries: 1 }).listFunds({}), []);
    assert.equal(calls, 2);
  });
  await withFetch(pendingFetch, async () => {
    await assert.rejects(() => new TefasClient({ timeoutMs: 20 }).listFunds(), matchesCode("TIMEOUT"));
    const controller = new AbortController();
    const running = new TefasClient().listFunds({ signal: controller.signal });
    const reason = new Error("Stop listing");
    const check = assert.rejects(running, (error) => matchesCode("ABORTED")(error) && error.cause === reason);
    controller.abort(reason);
    await check;
  });
  const controller = new AbortController();
  controller.abort();
  await withFetch(async () => {
    assert.fail("An already cancelled list must not send requests");
  }, async () => {
    await assert.rejects(() => new TefasClient().listFunds({ signal: controller.signal }), matchesCode("ABORTED"));
  });
});
