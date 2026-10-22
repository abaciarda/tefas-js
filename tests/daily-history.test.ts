import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import { TefasClient } from "../dist/index.js";
import type { FundSnapshot, GetDailyHistoryOptions } from "../dist/index.js";
import { countDays, mergeDailySnapshots, parseDailyChunk, planDailyChunks, validateDailyHistoryOptions } from "../dist/daily-history.js";
import { envelope, matchesCode, pendingFetch, withFetch } from "./helpers.js";

const row = (date: string, extra: Record<string, unknown> = {}) => ({
  fonKodu: "TI2", fonUnvan: " İŞ PORTFÖY ", tarih: date, fiyat: 2,
  tedPaySayisi: 100, kisiSayisi: 10, portfoyBuyukluk: 200, ...extra,
});
const snapshot = (date: string, extra: Partial<FundSnapshot> = {}): FundSnapshot => ({
  fundCode: "TI2", fundName: "İŞ PORTFÖY", kind: "YAT", date, price: 2,
  sharesOutstanding: 100, investorCount: 10, portfolioSize: 200, ...extra,
});
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}.json`, import.meta.url), "utf8"));
const isoDate = (value: unknown) => {
  assert.ok(typeof value === "string" && /^\d{8}$/.test(value));
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
};
const requestedRange = (body: string) => {
  const parsed = JSON.parse(body);
  return { from: isoDate(parsed.basTarih), to: isoDate(parsed.bitTarih) };
};
const chunk = { from: "2026-09-01", to: "2026-09-28" };
const threeChunks = { from: "2026-01-01", to: "2026-03-01" };

test("inclusive day counts and 28-day chunk boundaries follow UTC calendar arithmetic", () => {
  assert.equal(countDays("2026-10-10", "2026-10-10"), 1);
  assert.deepEqual(planDailyChunks("2026-10-10", "2026-10-10"), [{ from: "2026-10-10", to: "2026-10-10" }]);
  assert.deepEqual(planDailyChunks("2026-09-01", "2026-09-28"), [{ from: "2026-09-01", to: "2026-09-28" }]);
  assert.deepEqual(planDailyChunks("2026-09-01", "2026-09-29"), [
    { from: "2026-09-01", to: "2026-09-28" }, { from: "2026-09-29", to: "2026-09-29" },
  ]);
  assert.equal(countDays("2026-09-01", "2026-10-10"), 40);
  assert.deepEqual(planDailyChunks("2026-09-01", "2026-10-10"), [
    { from: "2026-09-01", to: "2026-09-28" }, { from: "2026-09-29", to: "2026-10-10" },
  ]);
  assert.deepEqual(planDailyChunks("2025-12-20", "2026-01-20"), [
    { from: "2025-12-20", to: "2026-01-16" }, { from: "2026-01-17", to: "2026-01-20" },
  ]);
  assert.deepEqual(planDailyChunks("2028-02-15", "2028-03-20"), [
    { from: "2028-02-15", to: "2028-03-13" }, { from: "2028-03-14", to: "2028-03-20" },
  ]);
  assert.deepEqual(planDailyChunks("2027-02-15", "2027-03-20"), [
    { from: "2027-02-15", to: "2027-03-14" }, { from: "2027-03-15", to: "2027-03-20" },
  ]);
  for (const [from, to, days] of [["2021-01-01", "2026-01-01", 1827], ["2026-03-01", "2026-11-30", 275]] as const) {
    assert.equal(countDays(from, to), days);
    const chunks = planDailyChunks(from, to);
    assert.equal(chunks.length, Math.ceil(days / 28));
    assert.equal(chunks[0]?.from, from);
    assert.equal(chunks.at(-1)?.to, to);
    let total = 0;
    for (const [index, entry] of chunks.entries()) {
      const length = countDays(entry.from, entry.to);
      assert.ok(length >= 1 && length <= 28);
      total += length;
      const next = chunks[index + 1];
      if (next !== undefined) assert.equal(countDays(entry.to, next.from), 2);
    }
    assert.equal(total, days);
  }
});

test("range validation accepts 1827 inclusive days and rejects 1828", () => {
  assert.equal(validateDailyHistoryOptions({ from: "2021-01-01", to: "2026-01-01" }, 10_000).chunks.length, 66);
  assert.throws(() => validateDailyHistoryOptions({ from: "2021-01-01", to: "2026-01-02" }, 10_000), matchesCode("INVALID_ARGUMENT"));
  assert.equal(validateDailyHistoryOptions({ from: "2026-10-10", to: "2026-10-10" }, 10_000).chunks.length, 1);
});

test("the default total timeout scales with chunks and stays a valid timer value", () => {
  const defaults = validateDailyHistoryOptions({ from: "2026-09-01", to: "2026-10-10" }, 10_000);
  assert.equal(defaults.kind, "YAT");
  assert.equal(defaults.minIntervalMs, 10_000);
  assert.equal(defaults.timeoutMs, 40_000);
  assert.equal(validateDailyHistoryOptions({ ...chunk, minIntervalMs: 0 }, 20).timeoutMs, 20);
  assert.equal(validateDailyHistoryOptions({ from: "2021-01-01", to: "2026-01-01", minIntervalMs: 60_000 }, 2_147_483_647).timeoutMs, 2_147_483_647);
  assert.equal(validateDailyHistoryOptions({ ...chunk, timeoutMs: 2_147_483_647 }, 10_000).timeoutMs, 2_147_483_647);
});

test("daily history sends one chunk body per range and maps the live fixture in date order", async () => {
  const payload = fixture("fonGnlBlgSiraliGetir-range");
  const original = structuredClone(payload);
  const options: GetDailyHistoryOptions = { ...chunk, minIntervalMs: 0 };
  const originalOptions = { ...options };
  let calls = 0;
  await withFetch(async (url, init) => {
    calls += 1;
    assert.equal(url, "https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir");
    assert.equal(init.method, "POST");
    assert.deepEqual(Object.fromEntries(new Headers(init.headers)), { accept: "application/json", "content-type": "application/json" });
    assert.deepEqual(JSON.parse(init.body), {
      fonTipi: "YAT", fonKodu: "TI2", aramaMetni: null, fonTurKod: null,
      fonGrubu: null, sfonTurKod: null, fonTurAciklama: null, kurucuKod: null,
      basTarih: "20260901", bitTarih: "20260928", basSira: 1, bitSira: 100000,
      dil: "TR", sFonTurKod: "", fonKod: "", fonGrup: "", fonUnvanTip: "",
    });
    return Response.json(payload);
  }, async () => {
    const history = await new TefasClient().getDailyHistory(" ti2 ", options);
    assert.equal(history.length, 20);
    assert.deepEqual(history[0], {
      fundCode: "TI2", fundName: "İŞ PORTFÖY HİSSE SENEDİ (TL) FONU (HİSSE SENEDİ YOĞUN FON)", kind: "YAT",
      date: "2026-09-01", price: 0.127035, sharesOutstanding: 26300312294, investorCount: 20726, portfolioSize: 3341064314.53,
    });
    assert.equal(history.at(-1)?.date, "2026-09-28");
    assert.deepEqual(history.map((entry) => entry.date), [...history.map((entry) => entry.date)].sort());
    assert.equal(history.some((entry) => entry.date === "2026-09-05" || entry.date === "2026-09-06"), false);
  });
  assert.equal(calls, 1);
  assert.deepEqual(payload, original);
  assert.deepEqual(options, originalOptions);
});

test("every chunk is requested sequentially with the requested fund kind", async () => {
  for (const kind of ["YAT", "EMK", "BYF", "GYF", "GSYF"] as const) {
    const ranges: { from: string; to: string }[] = [];
    let active = 0;
    await withFetch(async (_url, init) => {
      active += 1;
      assert.equal(active, 1);
      assert.equal(JSON.parse(init.body).fonTipi, kind);
      const range = requestedRange(init.body);
      ranges.push(range);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return Response.json(envelope([row(range.to)]));
    }, async () => {
      const history = await new TefasClient().getDailyHistory("TI2", { ...threeChunks, kind, minIntervalMs: 0 });
      assert.deepEqual(history.map((entry) => [entry.date, entry.kind]), [["2026-01-28", kind], ["2026-02-25", kind], ["2026-03-01", kind]]);
    });
    assert.deepEqual(ranges, [
      { from: "2026-01-01", to: "2026-01-28" }, { from: "2026-01-29", to: "2026-02-25" }, { from: "2026-02-26", to: "2026-03-01" },
    ]);
  }
});

test("chunk requests are spaced by minIntervalMs without delaying the first request", async () => {
  const starts: number[] = [];
  const began = performance.now();
  await withFetch(async (_url, init) => {
    starts.push(performance.now());
    return Response.json(envelope([row(requestedRange(init.body).from)]));
  }, async () => {
    assert.equal((await new TefasClient().getDailyHistory("TI2", { ...threeChunks, minIntervalMs: 60 })).length, 3);
  });
  assert.equal(starts.length, 3);
  assert.ok((starts[0] ?? Infinity) - began < 50);
  for (let index = 1; index < starts.length; index += 1) {
    assert.ok((starts[index] ?? 0) - (starts[index - 1] ?? 0) >= 55);
  }
});

test("retries count toward the interval without adding a second full wait", async () => {
  const starts: number[] = [];
  await withFetch(async () => {
    starts.push(performance.now());
    if (starts.length === 1) throw new TypeError("Temporary network failure");
    return Response.json(envelope([row("2026-09-01")]));
  }, async () => {
    await new TefasClient({ maxRetries: 1, timeoutMs: 5_000 }).getDailyHistory("TI2", { ...chunk, minIntervalMs: 600 });
  });
  assert.equal(starts.length, 2);
  assert.ok((starts[1] ?? 0) - (starts[0] ?? 0) >= 590);
  starts.length = 0;
  await withFetch(async () => {
    starts.push(performance.now());
    return starts.length === 1
      ? new Response("Busy", { status: 503, headers: { "Retry-After": "1" } })
      : Response.json(envelope([row("2026-09-01")]));
  }, async () => {
    await new TefasClient({ maxRetries: 1, timeoutMs: 5_000 }).getDailyHistory("TI2", { ...chunk, minIntervalMs: 600 });
  });
  const gap = (starts[1] ?? 0) - (starts[0] ?? 0);
  assert.ok(gap >= 990 && gap < 1_500);
});

test("invalid daily history arguments send no requests and report no progress", async () => {
  let calls = 0;
  let progress = 0;
  const onProgress = () => { progress += 1; };
  await withFetch(async () => { calls += 1; return Response.json(envelope()); }, async () => {
    const client = new TefasClient();
    for (const value of [undefined, null, [], {}, { from: chunk.from }, { to: chunk.to }, { ...chunk, typo: true },
      { from: "2026-02-30", to: "2026-03-01" }, { from: "2026-1-1", to: "2026-01-02" }, { from: "2026-09-01T00:00:00Z", to: chunk.to },
      { from: chunk.from, to: "2026-09-28+03:00" }, { from: 20260901, to: chunk.to }, { from: "2026-10-02", to: "2026-10-01" },
      { from: "2021-01-01", to: "2026-01-02" }, { ...chunk, kind: "F" }, { ...chunk, kind: "yat" }, { ...chunk, kind: null },
      { ...chunk, minIntervalMs: -1 }, { ...chunk, minIntervalMs: 60_001 }, { ...chunk, minIntervalMs: 1.5 }, { ...chunk, minIntervalMs: null },
      { ...chunk, minIntervalMs: "100" }, { ...chunk, minIntervalMs: NaN }, { ...chunk, timeoutMs: 0 }, { ...chunk, timeoutMs: 2_147_483_648 },
      { ...chunk, timeoutMs: NaN }, { ...chunk, timeoutMs: Infinity }, { ...chunk, timeoutMs: "1000" }, { ...chunk, timeoutMs: null },
      { ...chunk, timeoutMs: 1.5 }, { ...chunk, onProgress: {} }, { ...chunk, onProgress: null }, { ...chunk, signal: {} }]) {
      const options = value === undefined || value === null || Array.isArray(value) ? value : { onProgress, ...value };
      await assert.rejects(() => client.getDailyHistory("TI2", options as GetDailyHistoryOptions), matchesCode("INVALID_ARGUMENT"));
    }
    for (const code of [null, 123, "", "TI-2", "LONG"]) {
      await assert.rejects(() => client.getDailyHistory(code as string, { ...chunk, onProgress }), matchesCode("INVALID_ARGUMENT"));
    }
  });
  assert.equal(calls, 0);
  assert.equal(progress, 0);
});

test("unordered rows are sorted and identical same-day rows are deduplicated", async () => {
  await withFetch(async (_url, init) => {
    const { from, to } = requestedRange(init.body);
    return Response.json(envelope([row(to), row(from, { fiyat: 1 }), row(to)]));
  }, async () => {
    const history = await new TefasClient().getDailyHistory("TI2", { from: "2026-09-01", to: "2026-10-10", minIntervalMs: 0 });
    assert.deepEqual(history.map((entry) => [entry.date, entry.price]), [
      ["2026-09-01", 1], ["2026-09-28", 2], ["2026-09-29", 1], ["2026-10-10", 2],
    ]);
  });
  for (const extra of [{ fonUnvan: "Other" }, { fiyat: 3 }, { tedPaySayisi: 101 }, { kisiSayisi: 11 }, { portfoyBuyukluk: null }]) {
    assert.throws(
      () => mergeDailySnapshots(new Map(), parseDailyChunk(envelope([row("2026-09-02"), row("2026-09-02", extra)]), "TI2", "YAT", chunk)),
      matchesCode("INVALID_RESPONSE"),
    );
  }
  const byDate = new Map<string, FundSnapshot>([["2026-09-02", snapshot("2026-09-02")]]);
  mergeDailySnapshots(byDate, [snapshot("2026-09-02")]);
  assert.equal(byDate.size, 1);
  assert.throws(() => mergeDailySnapshots(byDate, [snapshot("2026-09-02", { price: 3 })]), matchesCode("INVALID_RESPONSE"));
});

test("chunk parsing rejects other funds, out-of-chunk dates and malformed rows", () => {
  for (const entry of [null, [], {}, row("2026-09-02", { fonKodu: "AAA" }), row("2026-09-02", { fonKodu: "ti2" }),
    row("2026-09-02", { fonUnvan: " " }), row("2026-08-31"), row("2026-09-29"), row("2026-09-31"), row("2026-09-02T00:00:00Z"),
    row("2026-09-02", { fiyat: null }), row("2026-09-02", { fiyat: "2" })]) {
    assert.throws(() => parseDailyChunk(envelope([entry]), "TI2", "YAT", chunk), matchesCode("INVALID_RESPONSE"));
  }
  for (const key of ["tedPaySayisi", "kisiSayisi", "portfoyBuyukluk"]) {
    for (const value of ["0", false, -1, NaN, Infinity, {}]) {
      assert.throws(() => parseDailyChunk(envelope([row("2026-09-02", { [key]: value })]), "TI2", "YAT", chunk), matchesCode("INVALID_RESPONSE"));
    }
  }
  const payload = envelope([row("2026-09-01", { fiyat: 0, tedPaySayisi: null, kisiSayisi: undefined, portfoyBuyukluk: 0 }),
    row("2026-09-28", { fiyat: 1.5, tedPaySayisi: 2.25 })]);
  const original = structuredClone(payload);
  assert.deepEqual(parseDailyChunk(payload, "TI2", "EMK", chunk), [
    snapshot("2026-09-01", { kind: "EMK", price: 0, sharesOutstanding: null, investorCount: null, portfolioSize: 0 }),
    snapshot("2026-09-28", { kind: "EMK", price: 1.5, sharesOutstanding: 2.25 }),
  ]);
  assert.deepEqual(payload, original);
  for (const broken of [null, [], {}, envelope(null), envelope({}), envelope([], { errorCode: undefined })]) {
    assert.throws(() => parseDailyChunk(broken, "TI2", "YAT", chunk), matchesCode("INVALID_RESPONSE"));
  }
});

test("a date from another chunk is rejected and stops later chunks", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return Response.json(envelope([row("2026-09-29")]));
  }, async () => {
    await assert.rejects(
      () => new TefasClient().getDailyHistory("TI2", { from: "2026-09-01", to: "2026-10-10", minIntervalMs: 0 }),
      matchesCode("INVALID_RESPONSE"),
    );
  });
  assert.equal(calls, 1);
});

test("empty chunks, the observed empty-day envelope and fully empty ranges yield no synthetic rows", async () => {
  const weekend = fixture("fonGnlBlgSiraliGetir-weekend");
  assert.deepEqual(parseDailyChunk(weekend, "TI2", "YAT", chunk), []);
  const progress: unknown[] = [];
  let calls = 0;
  await withFetch(async (_url, init) => {
    calls += 1;
    if (calls === 1) return Response.json(envelope([]));
    if (calls === 2) return Response.json(weekend);
    return Response.json(envelope([row(requestedRange(init.body).to)]));
  }, async () => {
    const history = await new TefasClient().getDailyHistory("TI2", {
      ...threeChunks, minIntervalMs: 0, onProgress: (entry) => progress.push(entry),
    });
    assert.deepEqual(history.map((entry) => entry.date), ["2026-03-01"]);
  });
  assert.deepEqual(progress, [{ completed: 1, total: 3 }, { completed: 2, total: 3 }, { completed: 3, total: 3 }]);
  await withFetch(async () => Response.json(envelope([])), async () => {
    assert.deepEqual(await new TefasClient().getDailyHistory("TI2", { ...threeChunks, minIntervalMs: 0 }), []);
  });
  for (const errorMessage of ["Index 0 out of bounds", "Index 0 out of bounds for length 0 ", "Another error"]) {
    assert.throws(() => parseDailyChunk(envelope(null, { errorMessage }), "TI2", "YAT", chunk), matchesCode("SOURCE_ERROR"));
  }
  assert.throws(
    () => parseDailyChunk(envelope(null, { errorCode: 7, errorMessage: "Index 0 out of bounds for length 0" }), "TI2", "YAT", chunk),
    (error) => matchesCode("SOURCE_ERROR")(error) && error.sourceCode === 7,
  );
});

test("each chunk has its own retry budget and permanent failures return no partial result", async () => {
  const attempts = new Map<string, number>();
  await withFetch(async (_url, init) => {
    const { from } = requestedRange(init.body);
    const count = (attempts.get(from) ?? 0) + 1;
    attempts.set(from, count);
    if (count === 1) throw new TypeError("Temporary network failure");
    return Response.json(envelope([row(from)]));
  }, async () => {
    assert.equal((await new TefasClient({ maxRetries: 1 }).getDailyHistory("TI2", { ...threeChunks, minIntervalMs: 0 })).length, 3);
  });
  assert.deepEqual([...attempts.values()], [2, 2, 2]);
  const ranges: string[] = [];
  let progress = 0;
  const controller = new AbortController();
  await withFetch(async (_url, init) => {
    const { from } = requestedRange(init.body);
    ranges.push(from);
    return from === "2026-01-29" ? new Response("Unavailable", { status: 503 }) : Response.json(envelope([row(from)]));
  }, async () => {
    await assert.rejects(
      () => new TefasClient({ maxRetries: 1 }).getDailyHistory("TI2", {
        ...threeChunks, minIntervalMs: 0, signal: controller.signal, onProgress: () => { progress += 1; },
      }),
      (error) => matchesCode("HTTP_ERROR")(error) && error.status === 503,
    );
  });
  assert.deepEqual(ranges, ["2026-01-01", "2026-01-29", "2026-01-29"]);
  assert.equal(progress, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  let deniedCalls = 0;
  await withFetch(async () => {
    deniedCalls += 1;
    return new Response("Web Application Firewall");
  }, async () => {
    await assert.rejects(
      () => new TefasClient({ maxRetries: 2 }).getDailyHistory("TI2", { ...threeChunks, minIntervalMs: 0 }),
      matchesCode("ACCESS_DENIED"),
    );
  });
  assert.equal(deniedCalls, 1);
});

test("user cancellation works before start, during fetch, between chunks and during retry waits", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  await withFetch(async () => { assert.fail("Cancelled daily history must not send requests"); }, async () => {
    await assert.rejects(() => new TefasClient().getDailyHistory("TI2", { ...chunk, signal: cancelled.signal }), matchesCode("ABORTED"));
  });
  const scenarios: readonly {
    readonly name: string;
    readonly fetcher: Parameters<typeof withFetch>[0];
    readonly options: Omit<GetDailyHistoryOptions, "signal">;
    readonly calls: number;
  }[] = [
    { name: "fetch", fetcher: pendingFetch, options: { ...chunk }, calls: 1 },
    {
      name: "interval",
      fetcher: async (_url, init) => Response.json(envelope([row(requestedRange(init.body).from)])),
      options: { ...threeChunks, minIntervalMs: 60_000 },
      calls: 1,
    },
    {
      name: "retry",
      fetcher: async () => new Response("Busy", { status: 503, headers: { "Retry-After": "30" } }),
      options: { ...chunk, minIntervalMs: 0 },
      calls: 1,
    },
  ];
  for (const scenario of scenarios) {
    const controller = new AbortController();
    const reason = new Error(`Stop during ${scenario.name}`);
    let calls = 0;
    await withFetch(async (url, init) => {
      calls += 1;
      setTimeout(() => controller.abort(reason), 20);
      return scenario.fetcher(url, init);
    }, async () => {
      await assert.rejects(
        () => new TefasClient({ maxRetries: 1, timeoutMs: 60_000 }).getDailyHistory("TI2", { ...scenario.options, signal: controller.signal }),
        (error) => matchesCode("ABORTED")(error) && error.cause === reason,
      );
    });
    assert.equal(calls, scenario.calls, scenario.name);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

test("total and per-chunk time limits both surface as TIMEOUT, never ABORTED", async () => {
  const controller = new AbortController();
  let calls = 0;
  await withFetch(async (_url, init) => {
    calls += 1;
    return Response.json(envelope([row(requestedRange(init.body).from)]));
  }, async () => {
    await assert.rejects(
      () => new TefasClient().getDailyHistory("TI2", { ...threeChunks, minIntervalMs: 60_000, timeoutMs: 50, signal: controller.signal }),
      matchesCode("TIMEOUT"),
    );
  });
  assert.equal(calls, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await withFetch(pendingFetch, async () => {
    await assert.rejects(
      () => new TefasClient({ timeoutMs: 60_000 }).getDailyHistory("TI2", { ...chunk, timeoutMs: 30, signal: controller.signal }),
      matchesCode("TIMEOUT"),
    );
    await assert.rejects(
      () => new TefasClient({ timeoutMs: 30 }).getDailyHistory("TI2", { ...chunk, timeoutMs: 60_000, signal: controller.signal }),
      matchesCode("TIMEOUT"),
    );
  });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("progress callback errors are rethrown unchanged and stop later requests", async () => {
  const failure = new Error("Progress failed");
  const controller = new AbortController();
  let calls = 0;
  await withFetch(async (_url, init) => {
    calls += 1;
    return Response.json(envelope([row(requestedRange(init.body).from)]));
  }, async () => {
    await assert.rejects(
      () => new TefasClient({ maxRetries: 2 }).getDailyHistory("TI2", {
        ...threeChunks, minIntervalMs: 0, signal: controller.signal, onProgress: () => { throw failure; },
      }),
      (error) => error === failure,
    );
  });
  assert.equal(calls, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("successful daily history removes its cancellation listeners", async () => {
  const controller = new AbortController();
  await withFetch(async (_url, init) => Response.json(envelope([row(requestedRange(init.body).from)])), async () => {
    await new TefasClient().getDailyHistory("TI2", { ...threeChunks, minIntervalMs: 0, signal: controller.signal });
  });
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
