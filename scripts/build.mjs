import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

await mkdir('lib', { recursive: true });
await build({
  entryPoints: ['src/index.ts', 'src/config.ts', 'src/native.ts', 'src/quote.ts', 'src/policy.ts', 'src/browser.ts'],
  outdir: 'lib', bundle: true, platform: 'node', format: 'esm', target: 'node22',
  packages: 'external', sourcemap: true,
});
await build({
  entryPoints: ['src/client.ts'], outfile: 'lib/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022', sourcemap: true,
  banner: { js: 'window.__ModuleLoader__.load({id:"dsh-plugin-winnotify",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' },
});
await cp('native', 'lib/native', { recursive: true });
await cp('assets', 'lib/assets', { recursive: true });
