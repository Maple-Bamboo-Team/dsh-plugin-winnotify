// src/index.ts
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { userInfo } from "node:os";

// src/config.ts
import z from "@deepseek-ai/schemastery";
var Config = z.object({
  welcome: z.boolean().default(true),
  approval: z.boolean().default(true),
  question: z.boolean().default(true),
  error: z.boolean().default(true),
  completed: z.boolean().default(true),
  interrupted: z.boolean().default(true),
  sound: z.boolean().default(true),
  quoteUrl: z.string().default("https://v1.hitokoto.cn/?encode=json&max_length=48"),
  quoteTimeoutMs: z.natural().min(1e3).max(12e4).default(15e3),
  heartbeatMs: z.natural().min(500).max(1e4).default(2e3),
  presenceTtlMs: z.natural().min(1500).max(6e4).default(8e3),
  notificationDelayMs: z.natural().max(5e3).default(300),
  nativeTimeoutMs: z.natural().min(1e3).max(3e4).default(8e3),
  maxBodyChars: z.natural().min(40).max(500).default(160)
});
function resolveOptions(input = {}) {
  const options = Config(input);
  if (options.presenceTtlMs < 3 * options.heartbeatMs) {
    throw new Error("WinNotify: presenceTtlMs must be at least 3 * heartbeatMs");
  }
  if (new URL(options.quoteUrl).protocol !== "https:") {
    throw new Error("WinNotify: quoteUrl must use HTTPS");
  }
  return options;
}

// src/native.ts
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
var NativeToast = class {
  constructor(signal, timeoutMs, sound) {
    this.signal = signal;
    this.timeoutMs = timeoutMs;
    this.sound = sound;
  }
  tail = Promise.resolve();
  show(notice, eligible = () => true) {
    const operation = this.tail.then(async () => {
      this.signal.throwIfAborted();
      if (!eligible()) return false;
      await invokeNative({ action: "show", ...notice, sound: this.sound }, this.signal, this.timeoutMs);
      return true;
    });
    this.tail = operation.then(() => {
    }, () => {
    });
    return operation;
  }
  async drained() {
    await this.tail;
  }
};
async function invokeNative(payload, signal, timeoutMs = 8e3) {
  signal.throwIfAborted();
  if (process.platform !== "win32") throw new Error("WinNotify requires Windows");
  const script = fileURLToPath(new URL("./native/toast.ps1", import.meta.url));
  const powershell = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key)));
  await new Promise((resolve, reject) => {
    const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env
    });
    let failure;
    let diagnostic = "";
    const collect = (data) => {
      diagnostic = (diagnostic + data.toString("utf8")).slice(-8192);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      failure = error;
    });
    child.stdin.on("error", (error) => {
      failure ??= error;
    });
    const abort = () => {
      failure = new Error("WinNotify delivery cancelled");
      child.kill();
    };
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      failure = new Error("WinNotify native helper timed out");
      child.kill();
    }, timeoutMs);
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`WinNotify native helper exited ${code}: ${diagnostic.trim()}`));
      else resolve();
    });
    if (signal.aborted) abort();
    child.stdin.end(JSON.stringify(payload));
  });
}

// src/quote.ts
var FALLBACK_QUOTE = "\u4E0D\u8BF1\u4E8E\u8A89\uFF0C\u4E0D\u6050\u4E8E\u8BFD\u3002";
function greeting(hour, username) {
  const word = hour < 5 ? "\u591C\u6DF1\u4E86" : hour < 11 ? "\u65E9\u4E0A\u597D" : hour < 13 ? "\u4E2D\u5348\u597D" : hour < 18 ? "\u4E0B\u5348\u597D" : "\u665A\u4E0A\u597D";
  return `${word}\uFF0C${username}`;
}
function compact(text, limit) {
  const chars = Array.from(text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim());
  return chars.length > limit ? chars.slice(0, limit - 1).join("") + "\u2026" : chars.join("");
}
async function fetchQuote(url, timeoutMs, signal, request = fetch) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  try {
    const response = await request(url, { signal: deadline, headers: { Accept: "application/json" } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Hitokoto response");
    let raw = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 16384) throw new Error("Hitokoto response too large");
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || !("hitokoto" in data) || typeof data.hitokoto !== "string" || !data.hitokoto.trim()) {
      throw new Error("Hitokoto returned no sentence");
    }
    return compact(data.hitokoto, 96);
  } catch {
    signal.throwIfAborted();
    return FALLBACK_QUOTE;
  }
}

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

// src/shared.ts
var CHANNEL = "/winnotify";
var SESSION_FRAGMENT = "winnotify-session";

// src/index.ts
var name = "WinNotify";
var inject = ["agents", "sessions", "connection", "webServer"];
var processKey = Symbol.for("dsh-plugin-winnotify.process-state.v1");
var processStore = globalThis;
function apply(ctx, input = {}) {
  const options = resolveOptions(input);
  if (process.platform !== "win32") {
    ctx.logger.warn("WinNotify requires a Windows host; notifications are disabled.");
    return;
  }
  const state = processStore[processKey] ??= { welcomeSent: false, turns: /* @__PURE__ */ new WeakMap() };
  const controller = new AbortController();
  const focus = new FocusTracker(options.presenceTtlMs);
  const queue = new DeliveryQueue();
  const native = new NativeToast(controller.signal, options.nativeTimeoutMs, options.sound);
  const pendingInteractions = /* @__PURE__ */ new Set();
  const owner = {};
  let welcomeTask = Promise.resolve();
  let requestNumber = 0;
  const warn = (error) => {
    if (!controller.signal.aborted) ctx.logger.warn(`WinNotify: ${error instanceof Error ? error.message : String(error)}`);
  };
  const target = (session) => {
    const ids = [session.id];
    let current = session;
    while (current.header.origin === "subagent" && current.header.parentSession && !ids.includes(current.header.parentSession)) {
      ids.push(current.header.parentSession);
      const parent = ctx.sessions.get(current.header.parentSession);
      if (!parent) break;
      current = parent;
    }
    return { id: ids.at(-1), ids, session: current };
  };
  const label = (session) => {
    try {
      const title = ctx.get("sessionTitle")?.get(session)?.title;
      if (title) return title;
    } catch (error) {
      warn(error);
    }
    return session.header.cwd ? basename(session.header.cwd) : session.id.slice(0, 8);
  };
  const interactionReason = (reason, title) => {
    let value = reason.trim().replace(/^escalate\s+sandbox\s+to\s+[^:：]+[:：]\s*/iu, "");
    if (value.startsWith(title)) value = value.slice(title.length).replace(/^\s*[:：]\s*/, "");
    return compact(value, Math.min(options.maxBodyChars, 64));
  };
  const inlineReason = (reason) => reason.replace(/^([^:：\r\n]+)\s*[:：]\s*/u, "$1\u2014\u2014");
  const inlineBody = (word, detail) => detail ? `${word}\uFF1A${inlineReason(detail)}` : word;
  const noticeText = (text) => {
    const lines = text.split(/\r?\n/u).map((line) => compact(line, options.maxBodyChars)).filter(Boolean);
    const value = lines.join("\n");
    const chars = Array.from(value);
    return chars.length > options.maxBodyChars ? `${chars.slice(0, options.maxBodyChars - 1).join("")}\u2026` : value;
  };
  const urlFor = (id) => {
    const url = new URL(ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}`));
    if (id) url.hash = `${SESSION_FRAGMENT}=${encodeURIComponent(id)}`;
    return url.href;
  };
  const notice = (key, title, body, id) => ({
    title: noticeText(title),
    body: noticeText(body),
    tag: createHash("sha256").update(key).digest("hex").slice(0, 16),
    url: urlFor(id)
  });
  const deliver = async (item, eligible) => {
    if (controller.signal.aborted || !eligible()) return false;
    try {
      return await native.show(item, eligible);
    } catch (error) {
      warn(error);
      return true;
    }
  };
  const turnState = (session, turn) => {
    let value = state.turns.get(session);
    if (!value || value.turn !== turn) {
      value = { turn, stepped: false, terminal: false };
      state.turns.set(session, value);
    }
    return value;
  };
  const terminal = (session, turn, kind, detail) => {
    const value = turnState(session, turn);
    if (value.terminal) return;
    value.terminal = true;
    if (!options[kind] || kind === "completed" && session.header.origin === "subagent") return;
    const destination = target(session);
    const words = { error: "\u672A\u7ECF\u5904\u7406\u7684\u5F02\u5E38", completed: "\u4EFB\u52A1\u5DF2\u5B8C\u6210", interrupted: "\u4EFB\u52A1\u4E2D\u65AD" };
    const body = kind === "error" ? detail ? `${words[kind]}\uFF1A${detail}` : words[kind] : inlineBody(words[kind], detail);
    const item = notice(`${session.id}:${turn}:terminal`, label(destination.session), body, destination.id);
    void queue.schedule(options.notificationDelayMs, () => deliver(item, () => !focus.focused(destination.ids)));
  };
  const checkPending = (pending) => {
    if (!pending.active || pending.notified || pending.queued || controller.signal.aborted) return;
    const destination = target(pending.agent.session);
    if (focus.focused(destination.ids)) return;
    pending.queued = true;
    const reason = interactionReason(pending.reason, label(destination.session));
    const body = inlineBody("\u7B49\u5F85\u56DE\u7B54", reason);
    const item = notice(`${pending.kind}:${pending.agent.id}:${++requestNumber}`, label(destination.session), body, destination.id);
    void queue.schedule(options.notificationDelayMs, () => deliver(item, () => pending.active && !focus.focused(destination.ids))).then((sent) => {
      pending.queued = false;
      pending.notified ||= sent;
    });
  };
  const checkPendingInteractions = () => {
    for (const pending of pendingInteractions) checkPending(pending);
  };
  ctx.effect(() => {
    const interval = setInterval(checkPendingInteractions, options.heartbeatMs);
    interval.unref();
    return async () => {
      clearInterval(interval);
      controller.abort();
      for (const pending of pendingInteractions) pending.active = false;
      pendingInteractions.clear();
      focus.clear();
      await queue.close();
      await Promise.allSettled([welcomeTask, native.drained()]);
      if (state.welcomeOwner === owner) delete state.welcomeOwner;
    };
  }, "WinNotify: drain notifications and cancel quote request");
  ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
    if (endpoint !== "presence") return { ok: false, error: { code: "not-found", message: "Unknown WinNotify endpoint", details: {} } };
    try {
      focus.update(parsePresence(payload));
    } catch (error) {
      return { ok: false, error: { code: "invalid-presence", message: String(error), details: {} } };
    }
    checkPendingInteractions();
    return { ok: true, value: { heartbeatMs: options.heartbeatMs } };
  });
  ctx.on("approval/request", async (req, next) => {
    if (!options.approval) return next();
    const pending = { kind: "approval", agent: req.agent, reason: req.reason || req.toolName, active: !req.signal?.aborted, notified: false, queued: false };
    const cancel = () => {
      pending.active = false;
      pendingInteractions.delete(pending);
    };
    req.signal?.addEventListener("abort", cancel, { once: true });
    pendingInteractions.add(pending);
    checkPending(pending);
    try {
      return await next();
    } finally {
      cancel();
      req.signal?.removeEventListener("abort", cancel);
    }
  }, { prepend: true });
  ctx.on("user-questions/request", async (req, next) => {
    if (!options.question || !req.agent) return next();
    const first = req.questions[0];
    const reason = first ? [first.header, first.question].filter(Boolean).join(": ") : "\u9700\u8981\u56DE\u7B54\u7684\u95EE\u9898";
    const pending = { kind: "question", agent: req.agent, reason, active: !req.signal?.aborted, notified: false, queued: false };
    const cancel = () => {
      pending.active = false;
      pendingInteractions.delete(pending);
    };
    req.signal?.addEventListener("abort", cancel, { once: true });
    pendingInteractions.add(pending);
    checkPending(pending);
    try {
      return await next();
    } finally {
      cancel();
      req.signal?.removeEventListener("abort", cancel);
    }
  }, { prepend: true });
  ctx.on("session/event", (session, event) => {
    if (event.type === "turn/start") turnState(session, event.data.turn);
    if (event.type === "step/start" || event.type === "step/end") turnState(session, event.data.turn).stepped = true;
    if (event.type !== "turn/end") return;
    const { turn, reason } = event.data;
    switch (reason.kind) {
      case "completed":
        if (turnState(session, turn).stepped) terminal(session, turn, "completed", "");
        break;
      case "error":
        terminal(session, turn, "error", reason.error.message);
        break;
      case "aborted":
        if (reason.reason.kind !== "disposed") terminal(session, turn, "interrupted", "\u6267\u884C\u5DF2\u53D6\u6D88");
        break;
      case "blocked":
        terminal(session, turn, "interrupted", "\u8BF7\u6C42\u88AB\u963B\u6B62");
        break;
      case "max-tokens":
        terminal(session, turn, "interrupted", "\u5DF2\u8FBE\u5230\u8F93\u51FA\u957F\u5EA6\u9650\u5236");
        break;
      default:
        break;
    }
  });
  ctx.on("agent/error", ({ agent, turn, error }) => terminal(agent.session, turn, "error", error instanceof Error ? error.message : String(error)));
  if (options.welcome && !state.welcomeSent && !state.welcomeOwner) {
    state.welcomeOwner = owner;
    welcomeTask = (async () => {
      const body = await fetchQuote(options.quoteUrl, options.quoteTimeoutMs, controller.signal);
      controller.signal.throwIfAborted();
      state.welcomeSent = true;
      await native.show({ title: greeting((/* @__PURE__ */ new Date()).getHours(), userInfo().username), body, tag: "welcome", url: urlFor() });
    })().catch(warn);
  }
}
export {
  Config,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
