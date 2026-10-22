import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TefasClient } from "../dist/index.js";
import type { FundKind, GetSnapshotsOptions } from "../dist/index.js";
import { parseSnapshots } from "../dist/snapshots.js";
import { envelope, matchesCode, pendingFetch, withFetch } from "./helpers.js";

const date = "2026-10-20";
const row = (extra: Record<string, unknown> = {}) => ({
  fonKodu: "TI2", fonUnvan: " İŞ PORTFÖY ", tarih: date, fiyat: 2,
  tedPaySayisi: 100, kisiSayisi: 10, portfoyBuyukluk: 200, ...extra,
});
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}.json`, import.meta.url), "utf8"));

test("single snapshots send the discovered daily body and map the real investment fund fixture", async () => {
  const payload = fixture("fonGnlBlgSiraliGetir-single");
  const original = structuredClone(payload);
  let calls = 0;
  await withFetch(async (url, init) => {
    calls += 1;
    assert.equal(url, "https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir");
    assert.equal(init.method, "POST");
    assert.deepEqual(Object.fromEntries(new Headers(init.headers)), {
      accept: "application/json", "content-type": "application/json",
    });
    assert.deepEqual(JSON.parse(init.body), {
      fonTipi: "YAT", fonKodu: "TI2", aramaMetni: null, fonTurKod: null,
      fonGrubu: null, sfonTurKod: null, fonTurAciklama: null, kurucuKod: null,
      basTarih: "20261020", bitTarih: "20261020", basSira: 1, bitSira: 100000,
      dil: "TR", sFonTurKod: "", fonKod: "", fonGrup: "", fonUnvanTip: "",
    });
    return Response.json(payload);
  }, async () => {
    assert.deepEqual(await new TefasClient().getSnapshot(" ti2 ", { date }), {
      fundCode: "TI2", fundName: "İŞ PORTFÖY HİSSE SENEDİ (TL) FONU (HİSSE SENEDİ YOĞUN FON)",
      kind: "YAT", date, price: 0.114357, sharesOutstanding: 24663540812,
      investorCount: 18953, portfolioSize: 2820436458.29,
    });
  });
  assert.equal(calls, 1);
  assert.deepEqual(payload, original);
});

test("all-fund snapshots request a null code and parse the trimmed multi-fund fixture", async () => {
  const payload = fixture("fonGnlBlgSiraliGetir-all");
  await withFetch(async (_url, init) => {
    assert.equal(JSON.parse(init.body).fonKodu, null);
    assert.equal(JSON.parse(init.body).fonTipi, "YAT");
    return Response.json(payload);
  }, async () => {
    const snapshots = await new TefasClient().getSnapshots({ date });
    assert.deepEqual(snapshots.map((snapshot) => snapshot.fundCode), ["AAL", "AAS", "AAV", "ABG", "ABJ"]);
    assert.equal(snapshots[0]?.portfolioSize, 1706845797.98);
    assert.equal(snapshots[0]?.investorCount, 4232);
    assert.ok(snapshots.every((snapshot) => snapshot.kind === "YAT" && snapshot.date === date));
  });
});

test("pension snapshots and all five fund kinds use the requested kind", async () => {
  await withFetch(async (_url, init) => {
    assert.equal(JSON.parse(init.body).fonTipi, "EMK");
    assert.equal(JSON.parse(init.body).fonKodu, "AE1");
    return Response.json(fixture("fonGnlBlgSiraliGetir-pension"));
  }, async () => {
    const snapshot = await new TefasClient().getSnapshot("AE1", { date, kind: "EMK" });
    assert.equal(snapshot?.kind, "EMK");
    assert.equal(snapshot?.sharesOutstanding, 189647880197.595);
    assert.equal(snapshot?.investorCount, 578332);
  });
  for (const kind of ["YAT", "EMK", "BYF", "GYF", "GSYF"] as const satisfies readonly FundKind[]) {
    await withFetch(async (_url, init) => {
      assert.equal(JSON.parse(init.body).fonTipi, kind);
      return Response.json(envelope([row()]));
    }, async () => {
      assert.equal((await new TefasClient().getSnapshot("TI2", { date, kind }))?.kind, kind);
    });
  }
});

test("missing numeric details become null while zero and fractional values are preserved", () => {
  const snapshots = parseSnapshots(envelope([
    row({ fonKodu: "AAA", fiyat: 0, tedPaySayisi: undefined, kisiSayisi: null, portfoyBuyukluk: undefined }),
    row({ fonKodu: "BBB", fiyat: 0, tedPaySayisi: 0, kisiSayisi: 0, portfoyBuyukluk: 0 }),
    row({ fonKodu: "CCC", tedPaySayisi: 1.5, portfoyBuyukluk: 2.75 }),
  ]), "YAT", date);
  assert.deepEqual(snapshots[0], {
    fundCode: "AAA", fundName: "İŞ PORTFÖY", kind: "YAT", date, price: 0,
    sharesOutstanding: null, investorCount: null, portfolioSize: null,
  });
  assert.equal(snapshots[1]?.sharesOutstanding, 0);
  assert.equal(snapshots[1]?.investorCount, 0);
  assert.equal(snapshots[1]?.portfolioSize, 0);
  assert.equal(snapshots[2]?.sharesOutstanding, 1.5);
  assert.equal(snapshots[2]?.portfolioSize, 2.75);
});

test("identical snapshots are deduplicated and every conflicting public value is rejected", () => {
  const payload = envelope([row(), row({ fonKodu: "AAA" }), row()]);
  const original = structuredClone(payload);
  assert.deepEqual(parseSnapshots(payload, "YAT", date).map((snapshot) => snapshot.fundCode), ["AAA", "TI2"]);
  assert.deepEqual(payload, original);
  assert.equal(parseSnapshots(envelope([row(), row()]), "YAT", date, "TI2").length, 1);
  for (const extra of [
    { fonUnvan: "Other" }, { fiyat: 3 }, { tedPaySayisi: 101 }, { kisiSayisi: 11 }, { portfoyBuyukluk: 201 },
  ]) {
    for (const fundCode of [undefined, "TI2"]) {
      assert.throws(() => parseSnapshots(envelope([row(), row(extra)]), "YAT", date, fundCode), matchesCode("INVALID_RESPONSE"));
    }
  }
});

test("snapshot parser rejects malformed rows, dates, codes and numeric values", () => {
  for (const entry of [null, [], {}, row({ fonKodu: "ti2" }), row({ fonUnvan: " " }), row({ fonUnvan: null }),
    row({ tarih: "2026-02-30" }), row({ tarih: "2026-10-19" }), row({ tarih: "2026-10-20T00:00:00Z" })]) {
    assert.throws(() => parseSnapshots(envelope([entry]), "YAT", date), matchesCode("INVALID_RESPONSE"));
  }
  for (const key of ["fiyat", "tedPaySayisi", "kisiSayisi", "portfoyBuyukluk"]) {
    for (const value of ["0", false, -1, NaN, Infinity, {}, []]) {
      assert.throws(() => parseSnapshots(envelope([row({ [key]: value })]), "YAT", date), matchesCode("INVALID_RESPONSE"));
    }
  }
  for (const value of [null, undefined]) {
    assert.throws(() => parseSnapshots(envelope([row({ fiyat: value })]), "YAT", date), matchesCode("INVALID_RESPONSE"));
  }
  assert.throws(() => parseSnapshots(envelope([row({ fonKodu: "AAA" })]), "YAT", date, "TI2"), matchesCode("INVALID_RESPONSE"));
  for (const payload of [null, [], {}, envelope(null), envelope({})]) {
    assert.throws(() => parseSnapshots(payload, "YAT", date), matchesCode("INVALID_RESPONSE"));
  }
});

test("only the observed empty-day response is recognized as an empty snapshot result", async () => {
  const payload = fixture("fonGnlBlgSiraliGetir-weekend");
  assert.deepEqual(parseSnapshots(payload, "YAT", "2026-10-18"), []);
  await withFetch(async () => Response.json(payload), async () => {
    const client = new TefasClient();
    assert.equal(await client.getSnapshot("TI2", { date: "2026-10-18" }), null);
    assert.deepEqual(await client.getSnapshots({ date: "2026-10-18" }), []);
  });
  for (const errorMessage of ["Index 0 out of bounds", "Index 0 out of bounds for length 0 ", "veri bulunamadı", "Another error"]) {
    assert.throws(() => parseSnapshots(envelope(null, { errorMessage }), "YAT", date), matchesCode("SOURCE_ERROR"));
  }
  assert.throws(
    () => parseSnapshots(envelope(null, { errorCode: 7, errorMessage: "Index 0 out of bounds for length 0" }), "YAT", date),
    (error) => matchesCode("SOURCE_ERROR")(error) && error.sourceCode === 7,
  );
});

test("empty successful responses yield null or an empty list", async () => {
  await withFetch(async () => Response.json(envelope()), async () => {
    const client = new TefasClient();
    assert.equal(await client.getSnapshot("TI2", { date }), null);
    assert.deepEqual(await client.getSnapshots({ date }), []);
  });
});

test("invalid snapshot arguments never send requests", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return Response.json(envelope());
  }, async () => {
    const client = new TefasClient();
    for (const value of [undefined, null, [], {}, { date: 20261020 }, { date: "2026-02-30" }, { date: "2026-1-1" },
      { date, kind: "yat" }, { date, kind: null }, { date, kind: "F" }, { date, signal: {} }, { date, typo: true }]) {
      const options = value as GetSnapshotsOptions;
      await assert.rejects(() => client.getSnapshots(options), matchesCode("INVALID_ARGUMENT"));
      await assert.rejects(() => client.getSnapshot("TI2", options), matchesCode("INVALID_ARGUMENT"));
    }
    for (const code of [null, 123, "", "TI-2", "LONG"]) {
      await assert.rejects(() => client.getSnapshot(code as string, { date }), matchesCode("INVALID_ARGUMENT"));
    }
  });
  assert.equal(calls, 0);
});

test("snapshot methods use shared retries, timeout and cancellation", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return calls === 1 ? new Response("Unavailable", { status: 503 }) : Response.json(envelope([row()]));
  }, async () => {
    assert.equal((await new TefasClient({ maxRetries: 1 }).getSnapshot("TI2", { date }))?.price, 2);
    assert.equal(calls, 2);
  });
  for (const body of ["<html>Web Application Firewall</html>", JSON.stringify(envelope([row({ fiyat: "bad" })]))]) {
    let attempts = 0;
    await withFetch(async () => {
      attempts += 1;
      return new Response(body);
    }, async () => {
      await assert.rejects(() => new TefasClient({ maxRetries: 2 }).getSnapshots({ date }));
    });
    assert.equal(attempts, 1);
  }
  await withFetch(pendingFetch, async () => {
    await assert.rejects(() => new TefasClient({ timeoutMs: 20 }).getSnapshots({ date }), matchesCode("TIMEOUT"));
    const controller = new AbortController();
    const reason = new Error("Stop snapshot");
    const running = new TefasClient().getSnapshot("TI2", { date, signal: controller.signal });
    const check = assert.rejects(running, (error) => matchesCode("ABORTED")(error) && error.cause === reason);
    controller.abort(reason);
    await check;
  });
  const controller = new AbortController();
  controller.abort();
  await withFetch(async () => { assert.fail("Cancelled snapshots must not send requests"); }, async () => {
    await assert.rejects(() => new TefasClient().getSnapshots({ date, signal: controller.signal }), matchesCode("ABORTED"));
    await assert.rejects(() => new TefasClient().getSnapshot("TI2", { date, signal: controller.signal }), matchesCode("ABORTED"));
  });
});
