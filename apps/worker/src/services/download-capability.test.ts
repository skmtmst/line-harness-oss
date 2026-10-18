import { afterEach, expect, it, vi } from 'vitest';
import { DOWNLOAD_TTL_SECONDS, signDownload, validDownload } from './download-capability.js';
afterEach(() => vi.useRealTimers());
it('binds the URL to purpose, resource, owner, key and a strict 15 minute deadline', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
  const url = new URL(await signDownload(new URL('https://worker.example/download?lineAccessToken=fixture'), 'fixture-key', 'statement', 'id', 'owner'));
  expect(url.searchParams.has('lineAccessToken')).toBe(false);
  expect(await validDownload(url, 'fixture-key', 'statement', 'id', 'owner')).toBe(true);
  for (const [secret, purpose, resource, owner] of [
    ['wrong', 'statement', 'id', 'owner'], ['fixture-key', 'attachment', 'id', 'owner'],
    ['fixture-key', 'statement', 'other-id', 'owner'], ['fixture-key', 'statement', 'id', 'other-owner'],
  ]) expect(await validDownload(url, secret, purpose, resource, owner)).toBe(false);
  const edited = new URL(url); edited.searchParams.set('expires', String(Number(url.searchParams.get('expires')) + 1));
  expect(await validDownload(edited, 'fixture-key', 'statement', 'id', 'owner')).toBe(false);
  vi.advanceTimersByTime(DOWNLOAD_TTL_SECONDS * 1000);
  expect(await validDownload(url, 'fixture-key', 'statement', 'id', 'owner')).toBe(false);
  expect(await validDownload(new URL('https://worker.example/download'), 'fixture-key', 'statement', 'id', 'owner')).toBe(false);
  await expect(signDownload(url, undefined, 'statement', 'id', 'owner')).rejects.toThrow('unconfigured');
});
