import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/services/signaling/registrationRecovery.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { registrationRejection, waitForRegistrationRetry, registrationRetryDelay, REGISTRATION_ATTEMPTS, REGISTRATION_BUDGET_MS } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

test('only the documented temporary identity conflict is retried after rejection', () => {
  assert.equal(registrationRejection('客户端身份已在使用中，请重新连接').retryable, true);
  for (const message of ['密码错误', '身份公钥或 challengeSignature 无效', '大厅已满', '']) {
    assert.equal(registrationRejection(message).retryable, false);
  }
});

test('retry policy gives transient startup problems time to recover with bounded backoff', () => {
  assert.equal(REGISTRATION_ATTEMPTS, 8);
  assert.equal(REGISTRATION_BUDGET_MS, 75000);
  assert.deepEqual([1,2,3,4,5,6,7].map(registrationRetryDelay), [1000,2000,4000,6000,6000,6000,6000]);
});

test('leaving during backoff cancels immediately and already-aborted sessions never wait', async () => {
  const controller = new AbortController();
  const pending = waitForRegistrationRetry(6000, controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejected;
  await assert.rejects(waitForRegistrationRetry(6000, controller.signal), { name: 'AbortError' });
});
