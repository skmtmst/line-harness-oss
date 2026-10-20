// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
vi.mock('@line/liff', () => ({ default: { init: async () => {}, isLoggedIn: () => true, getProfile: async () => ({ userId: 'fixture' }), getIDToken: () => 'fixture' } }));
import { initLiff } from './liff-auth.js';
test.each(['/booking?waitlist=w', '/booking?seat_waitlist=w&action=decline', '/booking/history'])('E3: LIFF単体もSDKが包んだ%sの行き先を復元する', async path => {
  window.history.replaceState(null, '', `/?liffId=fixture&liff.state=${encodeURIComponent(path)}`);
  await initLiff();
  expect(window.location.pathname).toBe(path.split('?')[0]);
  expect(window.location.search).toContain('liffId=fixture');
});
