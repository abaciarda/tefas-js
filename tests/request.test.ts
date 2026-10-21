import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { TefasError } from "../dist/errors.js";
import { executeRequest, withRequestContext } from "../dist/request.js";
import { waitForRetry } from "../dist/retry.js";
import { matchesCode } from "./helpers.js";

test("sequential requests share a context and get separate retry budgets", async () => {
  const controller = new AbortController();
  const signals: AbortSignal[] = [];
  const results = await withRequestContext(10_000, controller.signal, async (request) => {
    const values: unknown[] = [];
    for (const value of [1, 2]) {
      let attempts = 0;
      values.push(await executeRequest(request, 1, async (signal) => {
        signals.push(signal);
        attempts += 1;
        if (attempts === 1) throw new TefasError("NETWORK_ERROR", "Temporary failure");
        return value;
      }, (payload) => payload));
      assert.equal(attempts, 2);
      assert.equal(getEventListeners(controller.signal, "abort").length, 1);
    }
    return values;
  });
  assert.deepEqual(results, [1, 2]);
  assert.equal(signals.length, 4);
  assert.ok(signals.every((signal) => signal === signals[0]));
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("shared contexts map timeouts and user cancellation across sequential requests", async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    const reason = new Error("Stop the remaining requests");
    let completed = 0;
    await assert.rejects(
      () => withRequestContext(cancel ? 10_000 : 20, controller.signal, async (request) => {
        await executeRequest(request, 0, async () => 1, (payload) => payload);
        completed += 1;
        return executeRequest(request, 0, async (signal) => {
          if (cancel) controller.abort(reason);
          await waitForRetry(60_000, signal);
          return 2;
        }, (payload) => payload);
      }),
      (error) => matchesCode(cancel ? "ABORTED" : "TIMEOUT")(error) && (!cancel || error.cause === reason),
    );
    assert.equal(completed, 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});
