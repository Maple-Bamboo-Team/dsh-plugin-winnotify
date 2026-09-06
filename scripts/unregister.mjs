import { invokeNative } from '../lib/native.js';
await invokeNative({ action: 'unregister' }, new AbortController().signal);
console.log('WinNotify notification identity removed.');
