import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Cargo must create its profile directory through a real path, not through a
// chain of Windows junctions left behind when a build cache moved drives.
// Resolve the existing release cache so it is reused rather than rebuilt on C:.
export function resolveCargoTargetDirectory(targetDirectory, buildTarget = '') {
  const target = path.resolve(targetDirectory);
  const release = path.join(target, buildTarget, 'release');
  let entry;
  try { entry = fs.lstatSync(release); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (entry) {
    const physicalRelease = fs.realpathSync.native(release); // Broken links must fail explicitly.
    if (!fs.statSync(physicalRelease).isDirectory()) throw new Error(`Release cache is not a directory: ${release}`);
    const physicalParent = path.dirname(physicalRelease);
    if (!buildTarget) return physicalParent;
    if (path.basename(physicalParent).toLowerCase() === buildTarget.toLowerCase()) return path.dirname(physicalParent);
    throw new Error(`Release cache does not preserve the configured target '${buildTarget}': ${physicalRelease}`);
  }
  // A fresh target directory needs no migration. Cargo creates it normally.
  return fs.existsSync(target) ? fs.realpathSync.native(target) : target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Cargo target directory is required');
  console.log(JSON.stringify(resolveCargoTargetDirectory(process.argv[2], process.argv[3] || '')));
}
