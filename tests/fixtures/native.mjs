/** Test replacement for the external Windows notification API only. */
export class NativeToast {
  constructor(signal) { this.signal = signal; }
  async show(notice, eligible = () => true) {
    this.signal.throwIfAborted();
    if (!eligible()) return false;
    globalThis.__winnotifyTest.notices.push(notice);
    return true;
  }
  async drained() {}
}
