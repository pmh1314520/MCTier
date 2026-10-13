import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const commandModuleDir = fileURLToPath(
  new URL('../../src-tauri/src/modules/tauri_commands', import.meta.url),
);

export function readTauriCommandSources() {
  return fs
    .readdirSync(commandModuleDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.rs'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => fs.readFileSync(path.join(commandModuleDir, entry.name), 'utf8'))
    .join('\n');
}
