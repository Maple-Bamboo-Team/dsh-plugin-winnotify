import type { Presence } from './shared.ts';

/** Expiring page leases prevent a crashed browser from suppressing notifications forever. */
export class FocusTracker {
  private readonly pages = new Map<string, Presence & { expires: number }>();
  constructor(private readonly ttlMs: number, private readonly now = Date.now) {}

  update(value: Presence): void {
    this.prune();
    const previous = this.pages.get(value.clientId);
    if (previous && previous.sequence >= value.sequence) return;
    this.pages.set(value.clientId, { ...value, expires: this.now() + this.ttlMs });
  }

  focused(ids: readonly string[]): boolean {
    this.prune();
    return [...this.pages.values()].some(page => page.focused && page.sessionId !== null && ids.includes(page.sessionId));
  }

  clear(): void { this.pages.clear(); }

  private prune(): void {
    for (const [id, page] of this.pages) if (page.expires <= this.now()) this.pages.delete(id);
  }
}

/** Validate the browser/process boundary before accepting a focus report. */
export function parsePresence(value: unknown): Presence {
  if (!value || typeof value !== 'object') throw new Error('Expected a presence object');
  const data = value as Record<string, unknown>;
  if (typeof data.clientId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.clientId)
    || !Number.isSafeInteger(data.sequence) || (data.sequence as number) < 0
    || typeof data.focused !== 'boolean'
    || !(data.sessionId === null || typeof data.sessionId === 'string' && data.sessionId.length > 0 && data.sessionId.length <= 256)) {
    throw new Error('Invalid presence report');
  }
  return { clientId: data.clientId, sequence: data.sequence as number, focused: data.focused, sessionId: data.sessionId };
}

/** Own delayed work so disposal cancels timers and waits for already-started deliveries. */
export class DeliveryQueue {
  private closed = false;
  private readonly timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  private readonly active = new Set<Promise<boolean>>();

  schedule(delayMs: number, run: () => Promise<boolean>): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (this.closed) { resolve(false); return; }
        const task = Promise.resolve().then(run);
        this.active.add(task);
        void task.then(resolve, () => resolve(false)).finally(() => this.active.delete(task));
      }, delayMs);
      timer.unref?.();
      this.timers.set(timer, () => { clearTimeout(timer); resolve(false); });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
    await Promise.allSettled([...this.active]);
  }
}
