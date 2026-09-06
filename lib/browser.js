// src/browser.ts
function startFocusReporting(env) {
  const controller = new AbortController();
  let sequence = 0;
  let intervalMs = 2e3;
  let closed = false;
  let last = "";
  let timer;
  const tasks = /* @__PURE__ */ new Set();
  const publish = (force = false) => {
    if (closed) return;
    const value = { clientId: env.clientId, sequence: ++sequence, sessionId: env.current(), focused: env.focused() };
    const identity = JSON.stringify([value.sessionId, value.focused]);
    if (!force && last === identity) return;
    last = identity;
    const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(5e3)]);
    const task = env.send(value, requestSignal).then((ms) => {
      if (!closed && Number.isInteger(ms) && ms >= 500 && ms <= 1e4 && ms !== intervalMs) {
        intervalMs = ms;
        clearInterval(timer);
        timer = setInterval(() => publish(true), intervalMs);
      }
    }).catch(() => {
      last = "";
    });
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  };
  const unsubscribe = env.subscribe(() => publish());
  timer = setInterval(() => publish(true), intervalMs);
  publish(true);
  return {
    async dispose() {
      closed = true;
      unsubscribe();
      clearInterval(timer);
      controller.abort();
      await env.send({ clientId: env.clientId, sequence: ++sequence, sessionId: null, focused: false }, AbortSignal.timeout(1e3)).catch(() => {
      });
      await Promise.allSettled(tasks);
    }
  };
}
export {
  startFocusReporting
};
//# sourceMappingURL=browser.js.map
