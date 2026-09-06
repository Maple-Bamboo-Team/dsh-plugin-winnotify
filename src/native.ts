import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Notice } from './shared.ts';

/** Calls the inbox Windows PowerShell WinRT bridge without opening a console window. */
export class NativeToast {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly signal: AbortSignal, private readonly timeoutMs: number, private readonly sound: boolean) {}

  show(notice: Notice, eligible: () => boolean = () => true): Promise<boolean> {
    const operation = this.tail.then(async () => {
      this.signal.throwIfAborted();
      if (!eligible()) return false;
      await invokeNative({ action: 'show', ...notice, sound: this.sound }, this.signal, this.timeoutMs);
      return true;
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }

  async drained(): Promise<void> { await this.tail; }
}

/** Fixed executable and script; payloads only cross the child boundary as UTF-8 JSON. */
export async function invokeNative(payload: Record<string, unknown>, signal: AbortSignal, timeoutMs = 8000): Promise<void> {
  signal.throwIfAborted();
  if (process.platform !== 'win32') throw new Error('WinNotify requires Windows');
  const script = fileURLToPath(new URL('./native/toast.ps1', import.meta.url));
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/i.test(key)));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env,
    });
    let failure: Error | undefined;
    let diagnostic = '';
    const collect = (data: Buffer) => { diagnostic = (diagnostic + data.toString('utf8')).slice(-8192); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', error => { failure = error; });
    child.stdin.on('error', error => { failure ??= error; });
    const abort = () => { failure = new Error('WinNotify delivery cancelled'); child.kill(); };
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { failure = new Error('WinNotify native helper timed out'); child.kill(); }, timeoutMs);
    child.once('close', code => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`WinNotify native helper exited ${code}: ${diagnostic.trim()}`));
      else resolve();
    });
    if (signal.aborted) abort();
    child.stdin.end(JSON.stringify(payload));
  });
}
