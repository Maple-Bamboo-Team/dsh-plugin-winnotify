window.__ModuleLoader__.load({id:"dsh-plugin-winnotify",factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/shared.ts
var CHANNEL = "/winnotify";
var SESSION_FRAGMENT = "winnotify-session";

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

// src/client.ts
var inject = ["sessions", "connection"];
function apply(ctx) {
  const connection = ctx.get("connection");
  ctx.effect(() => {
    let visible = true;
    const reporter = startFocusReporting({
      clientId: crypto.randomUUID(),
      current: () => ctx.sessions.list.getSnapshot().current ?? null,
      focused: () => visible && document.visibilityState === "visible" && document.hasFocus(),
      subscribe(listener) {
        const hidden = () => {
          visible = false;
          listener();
        };
        const shown = () => {
          visible = true;
          listener();
        };
        window.addEventListener("blur", listener);
        window.addEventListener("focus", listener);
        document.addEventListener("visibilitychange", listener);
        window.addEventListener("pagehide", hidden);
        window.addEventListener("pageshow", shown);
        const unsubscribe = ctx.sessions.list.subscribe(listener);
        return () => {
          unsubscribe();
          window.removeEventListener("blur", listener);
          window.removeEventListener("focus", listener);
          document.removeEventListener("visibilitychange", listener);
          window.removeEventListener("pagehide", hidden);
          window.removeEventListener("pageshow", shown);
        };
      },
      async send(payload, signal) {
        const response = await connection.rpc.call(CHANNEL, "presence", payload, signal);
        if (!response.ok) throw new Error(response.error.message);
        const value = response.value;
        if (typeof value?.heartbeatMs !== "number") throw new Error("Invalid WinNotify heartbeat interval");
        return value.heartbeatMs;
      }
    });
    return () => reporter.dispose();
  }, "WinNotify: page focus reporting");
  ctx.effect(() => {
    let closed = false;
    let request = 0;
    const openLink = async () => {
      const marker = new URLSearchParams(location.hash.slice(1));
      const id = marker.get(SESSION_FRAGMENT);
      if (!id || id.length > 256) return;
      const currentRequest = ++request;
      try {
        await ctx.sessions.refresh();
        if (closed || currentRequest !== request) return;
        const state = ctx.sessions.list.getSnapshot();
        if (!state.byId[id]) return;
        ctx.sessions.open(id);
        marker.delete(SESSION_FRAGMENT);
        const remaining = marker.toString();
        history.replaceState(history.state, "", `${location.pathname}${location.search}${remaining ? `#${remaining}` : ""}`);
      } catch (error) {
        console.warn("WinNotify: could not open the notification session", error);
      }
    };
    const changed = () => {
      void openLink();
    };
    window.addEventListener("hashchange", changed);
    const disposeReset = ctx.on("connection/reset", changed);
    changed();
    return () => {
      closed = true;
      window.removeEventListener("hashchange", changed);
      disposeReset();
    };
  }, "WinNotify: open notification links");
}
return module.exports;}});
//# sourceMappingURL=client.js.map
