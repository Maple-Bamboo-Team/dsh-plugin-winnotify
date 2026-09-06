import type { Presence } from './shared.ts';

/** Browser-independent lifecycle used by the dsh page entry and focus tests. */
export interface FocusEnvironment {
  current(): string | null;
  focused(): boolean;
  subscribe(listener: () => void): () => void;
  send(value: Presence, signal: AbortSignal): Promise<number>;
  clientId: string;
}

/** Report every transition; sequence numbers let the Host ignore late HTTP responses. */
export function startFocusReporting(env: FocusEnvironment): { dispose(): Promise<void> } {
  const controller = new AbortController();
  let sequence = 0;
  let intervalMs = 2000;
  let closed = false;
  let last = '';
  let timer: ReturnType<typeof setInterval>;
  const tasks = new Set<Promise<void>>();
  const publish = (force = false) => {
    if (closed) return;
    const value = { clientId: env.clientId, sequence: ++sequence, sessionId: env.current(), focused: env.focused() };
    const identity = JSON.stringify([value.sessionId, value.focused]);
    if (!force && last === identity) return;
    last = identity;
    const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
    const task = env.send(value, requestSignal).then(ms => {
      if (!closed && Number.isInteger(ms) && ms >= 500 && ms <= 10000 && ms !== intervalMs) {
        intervalMs = ms;
        clearInterval(timer);
        timer = setInterval(() => publish(true), intervalMs);
      }
    }).catch(() => { last = ''; });
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
      // Normal plugin unload can release immediately; a closed tab also expires on the Host.
      await env.send({ clientId: env.clientId, sequence: ++sequence, sessionId: null, focused: false }, AbortSignal.timeout(1000)).catch(() => {});
      await Promise.allSettled(tasks);
    },
  };
}
