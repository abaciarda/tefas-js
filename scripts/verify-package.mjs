import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'tefas-js', 'Update consumer fixtures when renaming the package.');

const temporaryRoot = realpathSync(tmpdir());
const scratch = realpathSync(mkdtempSync(join(temporaryRoot, 'tefas-js-package-')));
const consumer = join(scratch, 'consumer');
const archive = join(scratch, `tefas-js-${manifest.version}.tgz`);

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

try {
  console.log('Creating and inspecting the package archive...');
  run('bun', ['pm', 'pack', '--destination', scratch], root);
  assert.ok(existsSync(archive), 'Package archive was not created.');

  const entries = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' })
    .split(/\r?\n/).filter((entry) => entry !== '' && !entry.endsWith('/'));
  const modules = ['client', 'errors', 'index', 'parser', 'request-context', 'retry', 'transport', 'types'];
  const required = new Set([
    'package/package.json',
    'package/README.md',
    'package/README.en.md',
    'package/LICENSE',
    ...modules.flatMap((name) => [`package/dist/${name}.js`, `package/dist/${name}.d.ts`]),
  ]);
  const allowed = new Set([
    ...required,
    'package/README.md', 'package/README',
    'package/LICENSE', 'package/LICENSE.md',
  ]);
  for (const entry of entries) {
    assert.ok(allowed.has(entry), `Unexpected archive file: ${entry}`);
  }
  for (const entry of required) {
    assert.ok(entries.includes(entry), `Missing archive file: ${entry}`);
  }

  cpSync(join(root, 'fixtures', 'package-consumer'), consumer, { recursive: true });
  run('bun', ['add', '--ignore-scripts', '--cache-dir', join(scratch, 'cache'), archive], consumer);

  const installedPath = join(consumer, 'node_modules', 'tefas-js');
  assert.equal(lstatSync(installedPath).isSymbolicLink(), false, 'Expected an installed archive, not a directory link.');
  const installed = JSON.parse(readFileSync(join(installedPath, 'package.json'), 'utf8'));
  assert.equal(installed.version, manifest.version);
  assert.equal(installed.type, 'module');
  assert.deepEqual(installed.exports['.'], {
    types: './dist/index.d.ts', import: './dist/index.js',
  });
  assert.equal(Object.keys(installed.dependencies ?? {}).length, 0);
  assert.equal(existsSync(join(consumer, 'node_modules', 'typescript')), false);

  run('node', ['smoke.js'], consumer);
  run('bun', ['smoke.js'], consumer);
  run('bun', ['run', 'tsc', '-p', join(consumer, 'tsconfig.json')], root);
  console.log('Consumer TypeScript OK');
  console.log('Package verification OK');
} finally {
  const resolved = realpathSync(scratch);
  assert.equal(resolved, scratch);
  assert.equal(dirname(resolved), temporaryRoot);
  assert.ok(basename(resolved).startsWith('tefas-js-package-'));
  assert.equal(lstatSync(resolved).isSymbolicLink(), false);
  rmSync(resolved, { recursive: true, force: true });
}
