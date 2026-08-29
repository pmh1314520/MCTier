import test from 'node:test';
import assert from 'node:assert/strict';
import { DOWNLOAD_WEBSITE, compareVersions, newestVersionTag } from '../src/services/version/versionPolicy.ts';

test('manual updates always target the official MCTier website', () => {
  assert.equal(DOWNLOAD_WEBSITE, 'https://mctier.pmhs.top');
});

test('version comparison is numeric rather than lexical', () => {
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
  assert.equal(compareVersions('v2.6', '2.6.0'), 0);
  assert.equal(compareVersions('2.5.9', '2.6.0'), -1);
});

test('newest tag does not depend on the Gitee response order', () => {
  const newest = newestVersionTag([{ name: 'v2.5.0' }, { name: 'v2.10.0' }, { name: 'v2.6.0' }]);
  assert.equal(newest?.name, 'v2.10.0');
});
