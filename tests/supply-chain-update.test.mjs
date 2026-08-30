import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('desktop update metadata is bounded and cannot follow redirects', () => {
  const service = read('src/services/version/VersionCheckService.ts');
  assert.match(service, /redirect:\s*'error'/);
  assert.match(service, /MAX_VERSION_RESPONSE_BYTES\s*=\s*256\s*\*\s*1024/);
  assert.match(service, /getReader\(\)/);
  assert.match(service, /\^\[0-9a-f\]\{40\}\$/i);
  assert.match(service, /per_page=100&page=1/);
});

test('Android update metadata is bounded and rejects redirects', () => {
  const checker = read('MCTier-Android/app/src/main/java/top/pmh13/mctier/network/UpdateChecker.kt');
  assert.match(checker, /followRedirects\(false\)/);
  assert.match(checker, /followSslRedirects\(false\)/);
  assert.match(checker, /MaxVersionResponseBytes\s*=\s*256\s*\*\s*1024L/);
  assert.match(checker, /readLimitedBody/);
  assert.match(checker, /CommitShaPattern/);
});

test('binary fetch script constrains network, archive, and publication paths', () => {
  const script = read('scripts/fetch-binaries.ps1');
  assert.match(script, /AllowAutoRedirect\s*=\s*\$false/);
  assert.match(script, /MaximumArchiveBytes\s*=\s*128MB/);
  assert.match(script, /MaximumExtractedBytes\s*=\s*128MB/);
  assert.match(script, /MaximumEntryCount\s*=\s*1000/);
  assert.match(script, /totalExtractedBytes/);
  assert.match(script, /Test-AllowedDownloadUri/);
  assert.match(script, /Test-ZipArchive/);
  assert.match(script, /Copy-VerifiedZipEntries/);
  assert.match(script, /Assert-SafeTargetDirectory/);
  assert.match(script, /ReparsePoint/);
  assert.doesNotMatch(script, /New-Item[^\n]*-LiteralPath/);
  assert.doesNotMatch(script, /\$host\s*=/i);
  assert.doesNotMatch(script, /ContentLength\.Value/);
  assert.doesNotMatch(script, /Expand-Archive/);
});

test('EasyTier JNI build pins source and locks Cargo dependencies', () => {
  const script = read('MCTier-Android/scripts/build-easytier-jni.ps1');
  assert.match(script, /Test-OfficialEasyTierRepo/);
  assert.match(script, /Test-ImmutableRevision/);
  assert.match(script, /Assert-CleanGitWorkTree/);
  assert.match(script, /status --porcelain=v1 --untracked-files=all/);
  assert.match(script, /github\.com\/EasyTier\/EasyTier\.git/);
  assert.match(script, /cargo build --target \$rustTarget --release --locked/);
  assert.match(script, /git -C \$EasyTierRoot fetch --no-tags origin \$Rev/);
});

test('CI actions and Gradle distribution use immutable or verified sources', () => {
  const workflow = read('.github/workflows/ci.yml');
  for (const line of workflow.split(/\r?\n/).filter((entry) => entry.includes('uses:'))) {
    assert.match(line, /@[0-9a-f]{40}/i, `mutable action reference: ${line}`);
  }
  // 每一个 checkout 都必须关掉凭据落盘，否则后续步骤能读到 GITHUB_TOKEN。
  // 这里不写死数量：新增 job 时数量会变，但"每个 checkout 都要有"这条性质不变。
  const checkoutCount = (workflow.match(/uses:\s*actions\/checkout@/g) ?? []).length;
  assert.ok(checkoutCount >= 5, `unexpected checkout count: ${checkoutCount}`);
  assert.equal(
    (workflow.match(/persist-credentials:\s*false/g) ?? []).length,
    checkoutCount,
  );
  assert.match(workflow, /cargo-audit --version 0\.22\.2 --locked/);
  assert.match(workflow, /cargo-deny --version 0\.20\.2 --locked/);

  const wrapper = read('MCTier-Android/gradle/wrapper/gradle-wrapper.properties');
  assert.match(wrapper, /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\//);
  assert.match(wrapper, /distributionSha256Sum=[0-9a-f]{64}/i);
});
