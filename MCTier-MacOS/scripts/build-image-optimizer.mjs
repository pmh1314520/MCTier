import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const latest = directory => existsSync(directory)
  ? readdirSync(directory).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] : undefined;
const ndkVersion = sdk && latest(join(sdk, 'ndk'));
const ndk = process.env.ANDROID_NDK_HOME || process.env.ANDROID_NDK_ROOT || (ndkVersion && join(sdk, 'ndk', ndkVersion));
if (!ndk || !existsSync(join(ndk, 'build/cmake/android.toolchain.cmake'))) throw new Error('Install an Android NDK and configure ANDROID_NDK_HOME or ANDROID_HOME.');
const cmakeVersion = sdk && latest(join(sdk, 'cmake'));
const cmakeBin = cmakeVersion && join(sdk, 'cmake', cmakeVersion, 'bin');
const output = resolve(process.argv[2] || join(root, 'MCTier-Android/app/build/generated/imageOptimizerJni'));
const result = spawnSync('cargo', ['ndk', '-t', 'arm64-v8a', '-P', '26', '-o', output, 'build', '--release', '--locked'], {
  cwd: join(root, 'shared/image-optimizer'), stdio: 'inherit', windowsHide: true,
  env: { ...process.env, ANDROID_NDK_HOME: ndk, ANDROID_NDK_ROOT: ndk, NDK_HOME: ndk,
    CMAKE_GENERATOR: 'Ninja', CMAKE_TOOLCHAIN_FILE: join(ndk, 'build/cmake/android.toolchain.cmake'),
    PATH: [cmakeBin, process.env.PATH].filter(Boolean).join(delimiter) },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
