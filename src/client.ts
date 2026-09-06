import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { CHANNEL, SESSION_FRAGMENT } from './shared.ts';
import { startFocusReporting } from './browser.ts';

export const inject = ['sessions', 'connection'];

/** Automatically loaded by dsh; no browser extension or user installation is needed. */
export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle;
  ctx.effect(() => {
    let visible = true;
    const reporter = startFocusReporting({
      clientId: crypto.randomUUID(),
      current: () => ctx.sessions.list.getSnapshot().current ?? null,
      focused: () => visible && document.visibilityState === 'visible' && document.hasFocus(),
      subscribe(listener) {
        const hidden = () => { visible = false; listener(); };
        const shown = () => { visible = true; listener(); };
        window.addEventListener('blur', listener);
        window.addEventListener('focus', listener);
        document.addEventListener('visibilitychange', listener);
        window.addEventListener('pagehide', hidden);
        window.addEventListener('pageshow', shown);
        const unsubscribe = ctx.sessions.list.subscribe(listener);
        return () => {
          unsubscribe();
          window.removeEventListener('blur', listener);
          window.removeEventListener('focus', listener);
          document.removeEventListener('visibilitychange', listener);
          window.removeEventListener('pagehide', hidden);
          window.removeEventListener('pageshow', shown);
        };
      },
      async send(payload, signal) {
        const response = await connection.rpc.call(CHANNEL, 'presence', payload, signal);
        if (!response.ok) throw new Error(response.error.message);
        const value = response.value as { heartbeatMs?: unknown };
        if (typeof value?.heartbeatMs !== 'number') throw new Error('Invalid WinNotify heartbeat interval');
        return value.heartbeatMs;
      },
    });
    return () => reporter.dispose();
  }, 'WinNotify: page focus reporting');

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
        if (!state.byId[id as SessionId]) return;
        ctx.sessions.open(id as SessionId);
        marker.delete(SESSION_FRAGMENT);
        const remaining = marker.toString();
        history.replaceState(history.state, '', `${location.pathname}${location.search}${remaining ? `#${remaining}` : ''}`);
      } catch (error) { console.warn('WinNotify: could not open the notification session', error); }
    };
    const changed = () => { void openLink(); };
    window.addEventListener('hashchange', changed);
    const disposeReset = ctx.on('connection/reset', changed);
    changed();
    return () => { closed = true; window.removeEventListener('hashchange', changed); disposeReset(); };
  }, 'WinNotify: open notification links');
}
