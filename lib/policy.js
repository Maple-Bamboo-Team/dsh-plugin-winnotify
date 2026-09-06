// src/policy.ts
var FocusTracker = class {
  constructor(ttlMs, now = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }
  pages = /* @__PURE__ */ new Map();
  update(value) {
    this.prune();
    const previous = this.pages.get(value.clientId);
    if (previous && previous.sequence >= value.sequence) return;
    this.pages.set(value.clientId, { ...value, expires: this.now() + this.ttlMs });
  }
  focused(ids) {
    this.prune();
    return [...this.pages.values()].some((page) => page.focused && page.sessionId !== null && ids.includes(page.sessionId));
  }
  clear() {
    this.pages.clear();
  }
  prune() {
    for (const [id, page] of this.pages) if (page.expires <= this.now()) this.pages.delete(id);
  }
};
function parsePresence(value) {
  if (!value || typeof value !== "object") throw new Error("Expected a presence object");
  const data = value;
  if (typeof data.clientId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(data.clientId) || !Number.isSafeInteger(data.sequence) || data.sequence < 0 || typeof data.focused !== "boolean" || !(data.sessionId === null || typeof data.sessionId === "string" && data.sessionId.length > 0 && data.sessionId.length <= 256)) {
    throw new Error("Invalid presence report");
  }
  return { clientId: data.clientId, sequence: data.sequence, focused: data.focused, sessionId: data.sessionId };
}
var DeliveryQueue = class {
  closed = false;
  timers = /* @__PURE__ */ new Map();
  active = /* @__PURE__ */ new Set();
  schedule(delayMs, run) {
    if (this.closed) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (this.closed) {
          resolve(false);
          return;
        }
        const task = Promise.resolve().then(run);
        this.active.add(task);
        void task.then(resolve, () => resolve(false)).finally(() => this.active.delete(task));
      }, delayMs);
      timer.unref?.();
      this.timers.set(timer, () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }
  async close() {
    this.closed = true;
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
    await Promise.allSettled([...this.active]);
  }
};
export {
  DeliveryQueue,
  FocusTracker,
  parsePresence
};
//# sourceMappingURL=policy.js.map
