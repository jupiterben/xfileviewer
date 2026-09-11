import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'win32') process.exit(0);
const root = fileURLToPath(new URL('../', import.meta.url));
const arch = process.env.XFILEVIEWER_MPV_ARCH || process.env.TAURI_ENV_ARCH || process.arch;
const architectures = { x64: 'x86_64', x86_64: 'x86_64', arm64: 'aarch64', aarch64: 'aarch64', ia32: 'i686', x86: 'i686', i686: 'i686' };
const target = architectures[arch];
const hashes = {
  x86_64: 'fac135c68a35b7639e39d72c0c365104edbaebdea39a0dfdd8c36e8c8e80faef',
  aarch64: '9d4e0cf7370fd1dd9a91a9d8139f24a88ece9e58b00f5a9ca50b391d03114f2f',
  i686: '8638828b06a30d9800667075815184e845a1b169cf07ada65b12595373cc1462',
};
if (!target) throw new Error(`Unsupported native player architecture: ${arch}`);
const name = `mpv-dev-${target}-20260903-git-69e63f425a.7z`;
const url = `https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20260903/${name}`;
const output = resolve(root, 'src-tauri/resources/mpv');
const cache = resolve(root, '.native-cache');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });
try {
  const record = JSON.parse(await readFile(resolve(output, 'runtime.json'), 'utf8'));
  if (record.archive === name && record.sha256 === digest(await readFile(resolve(output, 'libmpv-2.dll')))) {
    console.log(`Native video runtime ready (${target})`);
    process.exit(0);
  }
} catch { /* First build or changed architecture. */ }
const archive = resolve(cache, name);
let bytes;
try { bytes = await readFile(archive); } catch { /* Download below. */ }
if (!bytes || digest(bytes) !== hashes[target]) {
  console.log(`Downloading pinned native video runtime (${target})…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Runtime download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== hashes[target]) throw new Error('Native runtime SHA-256 mismatch');
  await writeFile(archive, bytes);
}
try {
  execFileSync('tar.exe', ['-xf', archive, '-C', output, 'libmpv-2.dll'], { stdio: 'inherit', windowsHide: true });
} catch (tarError) {
  // Some Windows bsdtar builds cannot decode BCJ2/LZMA archives.
  try {
    execFileSync('7z.exe', ['x', archive, `-o${output}`, 'libmpv-2.dll', '-y'], { stdio: 'inherit', windowsHide: true });
  } catch (sevenZipError) {
    throw new AggregateError([tarError, sevenZipError], 'Unable to extract libmpv. Install 7-Zip and add 7z.exe to PATH.');
  }
}
await copyFile(resolve(root, 'licenses/mpv-GPL-2.0.txt'), resolve(output, 'GPL-2.0.txt'));
await writeFile(resolve(output, 'runtime.json'), JSON.stringify({ archive: name, url, archiveSha256: hashes[target], sha256: digest(await readFile(resolve(output, 'libmpv-2.dll'))) }, null, 2));
console.log(`Native video runtime prepared (${target})`);
