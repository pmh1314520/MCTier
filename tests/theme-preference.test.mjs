import test from 'node:test';
import assert from 'node:assert/strict';
import { isThemePreference, resolveTheme } from '../src/theme/themePreference.ts';

test('system theme follows the operating-system color scheme', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('explicit themes do not depend on the system setting', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('persisted theme values are validated', () => {
  assert.equal(isThemePreference('system'), true);
  assert.equal(isThemePreference('light'), true);
  assert.equal(isThemePreference('dark'), true);
  assert.equal(isThemePreference('green'), false);
});
