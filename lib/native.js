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
export {
  NativeToast,
  invokeNative
};
//# sourceMappingURL=native.js.map
