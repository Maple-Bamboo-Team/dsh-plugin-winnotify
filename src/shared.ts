/** Wire constants shared by the two independently loaded Cordis entries. */
export const CHANNEL = '/winnotify';
export const SESSION_FRAGMENT = 'winnotify-session';

/** One page's latest viewing state, authenticated by dsh's Connection. */
export interface Presence {
  clientId: string;
  sequence: number;
  sessionId: string | null;
  focused: boolean;
}

/** Native notification payload; all text is data, never PowerShell source. */
export interface Notice {
  title: string;
  body: string;
  tag: string;
  url?: string;
}
