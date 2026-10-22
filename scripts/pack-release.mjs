import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const packages = ['core', 'react', 'transport', 'ui'];
const manifests = await Promise.all(
  packages.map(async (name) =>
    JSON.parse(await readFile(join(root, 'packages', name, 'package.json'), 'utf8')),
  ),
);
const version = manifests[0].version;
if (!version || manifests.some((manifest) => manifest.version !== version))
  throw new Error('All release packages must use the same version.');
const directory = join(root, 'artifacts', `v${version}`);
await mkdir(directory, { recursive: true });
const checksums = [];
for (const name of packages) {
  execFileSync('pnpm', ['pack', '--pack-destination', directory], {
    cwd: join(root, 'packages', name),
    stdio: 'inherit',
  });
  const filename = `sheet-${name}-${version}.tgz`;
  const checksum = createHash('sha256')
    .update(await readFile(join(directory, filename)))
    .digest('hex');
  checksums.push(`${checksum}  ${filename}`);
}
await writeFile(join(directory, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
console.log(`Release archives: ${directory}`);
