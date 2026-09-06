import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-user-approval';
import type {} from '@deepseek-ai/dsh-user-questions';
import type {} from '@deepseek-ai/dsh-session-title';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { userInfo } from 'node:os';
import { resolveOptions, type Options } from './config.ts';
import { NativeToast } from './native.ts';
import { compact, fetchQuote, greeting } from './quote.ts';
import { FocusTracker, DeliveryQueue, parsePresence } from './policy.ts';
import { CHANNEL, SESSION_FRAGMENT, type Notice } from './shared.ts';

export { Config } from './config.ts';
export const name = 'WinNotify';
export const inject = ['agents', 'sessions', 'connection', 'webServer'];

interface TurnState { turn: number; stepped: boolean; terminal: boolean }
interface PendingInteraction {
  kind: 'approval' | 'question';
  agent: Agent;
  reason: string;
  active: boolean;
  notified: boolean;
  queued: boolean;
}
interface ProcessState { welcomeSent: boolean; welcomeOwner?: object; turns: WeakMap<Session, TurnState> }
const processKey = Symbol.for('dsh-plugin-winnotify.process-state.v1');
const processStore = globalThis as typeof globalThis & { [processKey]?: ProcessState };

/** Mount the Host half. Its client half is automatically discovered through dsh.client. */
export function apply(ctx: Context, input: Partial<Options> = {}): void {
  const options = resolveOptions(input);
  if (process.platform !== 'win32') {
    ctx.logger.warn('WinNotify requires a Windows host; notifications are disabled.');
    return;
  }
  const state = processStore[processKey] ??= { welcomeSent: false, turns: new WeakMap() };
  const controller = new AbortController();
  const focus = new FocusTracker(options.presenceTtlMs);
  const queue = new DeliveryQueue();
  const native = new NativeToast(controller.signal, options.nativeTimeoutMs, options.sound);
  const pendingInteractions = new Set<PendingInteraction>();
  const owner = {};
  let welcomeTask = Promise.resolve();
  let requestNumber = 0;

  const warn = (error: unknown) => {
    if (!controller.signal.aborted) ctx.logger.warn(`WinNotify: ${error instanceof Error ? error.message : String(error)}`);
  };

  const target = (session: Session): { id: SessionId; ids: SessionId[]; session: Session } => {
    const ids: SessionId[] = [session.id];
    let current = session;
    while (current.header.origin === 'subagent' && current.header.parentSession && !ids.includes(current.header.parentSession)) {
      ids.push(current.header.parentSession);
      const parent = ctx.sessions.get(current.header.parentSession);
      if (!parent) break;
      current = parent;
    }
    return { id: ids.at(-1)!, ids, session: current };
  };
  const label = (session: Session) => {
    try {
      const title = ctx.get('sessionTitle')?.get(session)?.title;
      if (title) return title;
    } catch (error) { warn(error); }
    return session.header.cwd ? basename(session.header.cwd) : session.id.slice(0, 8);
  };
  const interactionReason = (reason: string, title: string) => {
    let value = reason.trim().replace(/^escalate\s+sandbox\s+to\s+[^:：]+[:：]\s*/iu, '');
    if (value.startsWith(title)) value = value.slice(title.length).replace(/^\s*[:：]\s*/, '');
    return compact(value, Math.min(options.maxBodyChars, 64));
  };
  const inlineReason = (reason: string) => reason.replace(/^([^:：\r\n]+)\s*[:：]\s*/u, '$1——');
  const inlineBody = (word: string, detail: string) => detail ? `${word}：${inlineReason(detail)}` : word;
  const noticeText = (text: string) => {
    const lines = text.split(/\r?\n/u).map(line => compact(line, options.maxBodyChars)).filter(Boolean);
    const value = lines.join('\n');
    const chars = Array.from(value);
    return chars.length > options.maxBodyChars ? `${chars.slice(0, options.maxBodyChars - 1).join('')}\u2026` : value;
  };
  const urlFor = (id?: SessionId) => {
    const url = new URL(ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}`));
    if (id) url.hash = `${SESSION_FRAGMENT}=${encodeURIComponent(id)}`;
    return url.href;
  };
  const notice = (key: string, title: string, body: string, id?: SessionId): Notice => ({
    title: noticeText(title), body: noticeText(body),
    tag: createHash('sha256').update(key).digest('hex').slice(0, 16), url: urlFor(id),
  });
  const deliver = async (item: Notice, eligible: () => boolean): Promise<boolean> => {
    if (controller.signal.aborted || !eligible()) return false;
    try { return await native.show(item, eligible); }
    catch (error) { warn(error); return true; }
  };
  const turnState = (session: Session, turn: number): TurnState => {
    let value = state.turns.get(session);
    if (!value || value.turn !== turn) {
      value = { turn, stepped: false, terminal: false };
      state.turns.set(session, value);
    }
    return value;
  };
  const terminal = (session: Session, turn: number, kind: 'error' | 'completed' | 'interrupted', detail: string) => {
    const value = turnState(session, turn);
    if (value.terminal) return;
    value.terminal = true;
    if (!options[kind] || kind === 'completed' && session.header.origin === 'subagent') return;
    const destination = target(session);
    const words = { error: '\u672a\u7ecf\u5904\u7406\u7684\u5f02\u5e38', completed: '\u4efb\u52a1\u5df2\u5b8c\u6210', interrupted: '\u4efb\u52a1\u4e2d\u65ad' };
    const body = kind === 'error'
      ? (detail ? `${words[kind]}：${detail}` : words[kind])
      : inlineBody(words[kind], detail);
    const item = notice(`${session.id}:${turn}:terminal`, label(destination.session), body, destination.id);
    void queue.schedule(options.notificationDelayMs, () => deliver(item, () => !focus.focused(destination.ids)));
  };
  const checkPending = (pending: PendingInteraction) => {
    if (!pending.active || pending.notified || pending.queued || controller.signal.aborted) return;
    const destination = target(pending.agent.session);
    if (focus.focused(destination.ids)) return;
    pending.queued = true;
    const reason = interactionReason(pending.reason, label(destination.session));
    const body = inlineBody('等待回答', reason);
    const item = notice(`${pending.kind}:${pending.agent.id}:${++requestNumber}`, label(destination.session), body, destination.id);
    void queue.schedule(options.notificationDelayMs, () => deliver(item, () => pending.active && !focus.focused(destination.ids)))
      .then(sent => { pending.queued = false; pending.notified ||= sent; });
  };
  const checkPendingInteractions = () => { for (const pending of pendingInteractions) checkPending(pending); };

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
  }, 'WinNotify: drain notifications and cancel quote request');

  ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
    if (endpoint !== 'presence') return { ok: false, error: { code: 'not-found', message: 'Unknown WinNotify endpoint', details: {} } };
    try { focus.update(parsePresence(payload)); }
    catch (error) { return { ok: false, error: { code: 'invalid-presence', message: String(error), details: {} } }; }
    checkPendingInteractions();
    return { ok: true, value: { heartbeatMs: options.heartbeatMs } };
  });

  ctx.on('approval/request', async (req, next) => {
    if (!options.approval) return next();
    const pending: PendingInteraction = { kind: 'approval', agent: req.agent, reason: req.reason || req.toolName, active: !req.signal?.aborted, notified: false, queued: false };
    const cancel = () => { pending.active = false; pendingInteractions.delete(pending); };
    req.signal?.addEventListener('abort', cancel, { once: true });
    pendingInteractions.add(pending);
    checkPending(pending);
    try { return await next(); }
    finally { cancel(); req.signal?.removeEventListener('abort', cancel); }
  }, { prepend: true });

  ctx.on('user-questions/request', async (req, next) => {
    if (!options.question || !req.agent) return next();
    const first = req.questions[0];
    const reason = first ? [first.header, first.question].filter(Boolean).join(': ') : '\u9700\u8981\u56de\u7b54\u7684\u95ee\u9898';
    const pending: PendingInteraction = { kind: 'question', agent: req.agent, reason, active: !req.signal?.aborted, notified: false, queued: false };
    const cancel = () => { pending.active = false; pendingInteractions.delete(pending); };
    req.signal?.addEventListener('abort', cancel, { once: true });
    pendingInteractions.add(pending);
    checkPending(pending);
    try { return await next(); }
    finally { cancel(); req.signal?.removeEventListener('abort', cancel); }
  }, { prepend: true });

  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') turnState(session, event.data.turn);
    if (event.type === 'step/start' || event.type === 'step/end') turnState(session, event.data.turn).stepped = true;
    if (event.type !== 'turn/end') return;
    const { turn, reason } = event.data;
    switch (reason.kind) {
      case 'completed':
        if (turnState(session, turn).stepped) terminal(session, turn, 'completed', '');
        break;
      case 'error': terminal(session, turn, 'error', reason.error.message); break;
      case 'aborted':
        if (reason.reason.kind !== 'disposed') terminal(session, turn, 'interrupted', '\u6267\u884c\u5df2\u53d6\u6d88');
        break;
      case 'blocked': terminal(session, turn, 'interrupted', '\u8bf7\u6c42\u88ab\u963b\u6b62'); break;
      case 'max-tokens': terminal(session, turn, 'interrupted', '\u5df2\u8fbe\u5230\u8f93\u51fa\u957f\u5ea6\u9650\u5236'); break;
      default: break; // Historical repair and other plugins' end reasons are not live notifications.
    }
  });
  ctx.on('agent/error', ({ agent, turn, error }) => terminal(agent.session, turn, 'error', error instanceof Error ? error.message : String(error)));

  if (options.welcome && !state.welcomeSent && !state.welcomeOwner) {
    state.welcomeOwner = owner;
    welcomeTask = (async () => {
      const body = await fetchQuote(options.quoteUrl, options.quoteTimeoutMs, controller.signal);
      controller.signal.throwIfAborted();
      state.welcomeSent = true;
      await native.show({ title: greeting(new Date().getHours(), userInfo().username), body, tag: 'welcome', url: urlFor() });
    })().catch(warn);
  }
}
