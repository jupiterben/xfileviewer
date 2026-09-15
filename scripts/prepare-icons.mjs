import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'assets/icon-source.svg');
const outDir = resolve(root, 'src-tauri/icons');
const outputs = [
  resolve(outDir, '32x32.png'),
  resolve(outDir, '128x128.png'),
  resolve(outDir, '128x128@2x.png'),
  resolve(outDir, 'icon.icns'),
  resolve(outDir, 'icon.ico'),
  resolve(outDir, 'icon.png'),
];

if (!existsSync(source)) {
  throw new Error('Missing assets/icon-source.svg');
}

const sourceMtime = statSync(source).mtimeMs;
const stale = outputs.some((path) => !existsSync(path) || sourceMtime > statSync(path).mtimeMs);
if (!stale) {
  console.log('App icons up to date');
  process.exit(0);
}

const cli = resolve(root, 'node_modules/@tauri-apps/cli/tauri.js');
if (!existsSync(cli)) {
  throw new Error('Missing @tauri-apps/cli. Run npm ci first.');
}

console.log('Generating app icons from icon-source.svg…');
execFileSync(process.execPath, [cli, 'icon', source, '-o', outDir], {
  stdio: 'inherit',
  cwd: root,
});
