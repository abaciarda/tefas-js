type AbortCode = "TIMEOUT" | "ABORTED";

export function createRequestContext(timeoutMs: number, userSignal?: AbortSignal) {
  const controller = new AbortController();
  let abortCode: AbortCode | undefined;

  const abort = (code: AbortCode, reason: unknown) => {
    if (controller.signal.aborted) return;
    abortCode = code;
    controller.abort(reason);
  };

  const onUserAbort = () => abort("ABORTED", userSignal?.reason);

  if (userSignal?.aborted) {
    onUserAbort();
  } else {
    userSignal?.addEventListener("abort", onUserAbort, { once: true });
  }

  const timer = setTimeout(() => {
    abort("TIMEOUT", new Error("Request timeout exceeded."));
  }, timeoutMs);

  return {
    signal: controller.signal,
    getAbortCode: (): AbortCode | undefined => abortCode,
    cleanup: () => {
      clearTimeout(timer);
      userSignal?.removeEventListener("abort", onUserAbort);
    },
  };
}
