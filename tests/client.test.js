import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { TefasClient } from "../dist/index.js";
import { envelope, row, matchesCode, withFetch, pendingFetch } from "./helpers.js";

test("client construction is passive and history normalizes the request", async () => {
  let calls = 0;
  await withFetch(
    async (_url, init) => {
      calls += 1;
      assert.deepEqual(JSON.parse(init.body), { fonKodu: "TI2", dil: "TR", periyod: 12 });
      return Response.json(envelope([row("2026-10-20", 2), row("2026-10-19", 1)]));
    },
    async () => {
      const client = new TefasClient();
      assert.equal(calls, 0);
      const result = await client.getPriceHistory(" ti2 ", { periodMonths: 12 });
      assert.equal(result.fundCode, "TI2");
      assert.equal(result.periodMonths, 12);
      assert.deepEqual(
        result.prices.map((price) => price.date),
        ["2026-10-19", "2026-10-20"],
      );
      assert.equal(calls, 1);
    },
  );
});

test("invalid client and query arguments never send HTTP requests", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return Response.json(envelope());
    },
    async () => {
      for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, "10", null, 2_147_483_648]) {
        assert.throws(() => new TefasClient({ timeoutMs }), matchesCode("INVALID_ARGUMENT"));
      }
      for (const maxRetries of [-1, 3, 0.5, "1", NaN, Infinity, null]) {
        assert.throws(() => new TefasClient({ maxRetries }), matchesCode("INVALID_ARGUMENT"));
      }
      const client = new TefasClient();
      for (const code of [null, 123, "", "TI-2", "T I2", "TOOLONG"]) {
        await assert.rejects(() => client.getPriceHistory(code, { periodMonths: 1 }), matchesCode("INVALID_ARGUMENT"));
      }
      for (const options of [
        undefined,
        null,
        [],
        {},
        { periodMonths: "12" },
        { periodMonths: 2 },
        { periodMonths: NaN },
        { periodMonths: 1, signal: {} },
        { periodMonths: 1, typo: true },
      ]) {
        await assert.rejects(() => client.getPriceHistory("TI2", options), matchesCode("INVALID_ARGUMENT"));
      }
      assert.equal(calls, 0);
    },
  );
});

test("default retry is disabled and explicit retries have an attempt limit", async () => {
  for (const maxRetries of [undefined, 1, 2]) {
    let calls = 0;
    const options = maxRetries === undefined ? {} : { maxRetries };
    await withFetch(
      async () => {
        calls += 1;
        return new Response("Unavailable", { status: 503 });
      },
      async () => {
        await assert.rejects(
          () => new TefasClient(options).getPriceHistory("TI2", { periodMonths: 1 }),
          matchesCode("HTTP_ERROR"),
        );
      },
    );
    assert.equal(calls, 1 + (maxRetries ?? 0));
  }
});

test("temporary HTTP and network failures can recover on a retry", async () => {
  for (const network of [false, true]) {
    let calls = 0;
    await withFetch(
      async () => {
        calls += 1;
        if (calls > 1) return Response.json(envelope());
        if (network) throw new Error("Connection interrupted");
        return new Response("Unavailable", { status: 503 });
      },
      async () => {
        const result = await new TefasClient({ maxRetries: 1 }).getPriceHistory("TI2", { periodMonths: 1 });
        assert.deepEqual(result.prices, []);
      },
    );
    assert.equal(calls, 2);
  }
});

test("permanent failures and excessive server waits are not retried", async () => {
  for (const [factory, code] of [
    [() => new Response("Forbidden", { status: 403 }), "ACCESS_DENIED"],
    [() => new Response("Failure", { status: 500 }), "HTTP_ERROR"],
    [() => new Response("not JSON"), "INVALID_RESPONSE"],
    [() => Response.json({ errorCode: 7, errorMessage: "Failure" }), "SOURCE_ERROR"],
    [() => new Response("Wait", { status: 429, headers: { "Retry-After": "86400" } }), "HTTP_ERROR"],
    [() => new Response("Wait", { status: 503, headers: { "Retry-After": "invalid" } }), "HTTP_ERROR"],
  ]) {
    let calls = 0;
    await withFetch(
      async () => {
        calls += 1;
        return factory();
      },
      async () => {
        await assert.rejects(
          () => new TefasClient({ maxRetries: 2 }).getPriceHistory("TI2", { periodMonths: 1 }),
          matchesCode(code),
        );
      },
    );
    assert.equal(calls, 1);
  }
});

test("already cancelled queries send no request and keep the reason", async () => {
  let calls = 0;
  const controller = new AbortController();
  const reason = new Error("Cancelled before start");
  controller.abort(reason);
  await withFetch(
    async () => {
      calls += 1;
      return Response.json(envelope());
    },
    async () => {
      await assert.rejects(
        () => new TefasClient().getPriceHistory("TI2", { periodMonths: 1, signal: controller.signal }),
        (error) => matchesCode("ABORTED")(error) && error.cause === reason,
      );
    },
  );
  assert.equal(calls, 0);
});

test("timeout applies before headers and while reading the body", async () => {
  const bodyPending = async (_url, init) =>
    new Response(
      new ReadableStream({
        start(stream) {
          const stop = () => stream.error(init.signal.reason);
          if (init.signal.aborted) stop();
          else init.signal.addEventListener("abort", stop, { once: true });
        },
      }),
    );
  for (const fetcher of [pendingFetch, bodyPending]) {
    await withFetch(fetcher, async () => {
      await assert.rejects(
        () => new TefasClient({ timeoutMs: 20 }).getPriceHistory("TI2", { periodMonths: 1 }),
        matchesCode("TIMEOUT"),
      );
    });
  }
});

test("timeout and user cancellation interrupt retry waits", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return new Response("Wait", { status: 429, headers: { "Retry-After": "60" } });
    },
    async () => {
      await assert.rejects(
        () => new TefasClient({ timeoutMs: 20, maxRetries: 2 }).getPriceHistory("TI2", { periodMonths: 1 }),
        matchesCode("TIMEOUT"),
      );
      assert.equal(calls, 1);
      const controller = new AbortController();
      const running = new TefasClient({ maxRetries: 2 }).getPriceHistory("TI2", {
        periodMonths: 1,
        signal: controller.signal,
      });
      const check = assert.rejects(running, matchesCode("ABORTED"));
      const timer = setTimeout(() => controller.abort(), 10);
      try {
        await check;
      } finally {
        clearTimeout(timer);
      }
      assert.equal(calls, 2);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    },
  );
});

test("success and errors both remove external cancellation listeners", async () => {
  for (const failed of [false, true]) {
    const controller = new AbortController();
    await withFetch(
      async () => (failed ? new Response("Unavailable", { status: 503 }) : Response.json(envelope())),
      async () => {
        const running = new TefasClient().getPriceHistory("TI2", { periodMonths: 1, signal: controller.signal });
        if (failed) await assert.rejects(running, matchesCode("HTTP_ERROR"));
        else await running;
        assert.equal(getEventListeners(controller.signal, "abort").length, 0);
      },
    );
  }
});

test("cancelling one query does not cancel another query on the same client", async () => {
  await withFetch(
    async (url, init) =>
      JSON.parse(init.body).fonKodu === "TI2" ? pendingFetch(url, init) : Response.json(envelope()),
    async () => {
      const client = new TefasClient();
      const controller = new AbortController();
      const cancelled = client.getPriceHistory("TI2", { periodMonths: 1, signal: controller.signal });
      const check = assert.rejects(cancelled, matchesCode("ABORTED"));
      const successful = client.getPriceHistory("ABC", { periodMonths: 1 });
      controller.abort();
      await check;
      assert.deepEqual((await successful).prices, []);
    },
  );
});
