import { afterEach, beforeEach, expect, test } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { withScheduledWorkLease } from './scheduled-work-lease.js';

let fixture: ReturnType<typeof createTestD1>;
beforeEach(() => { fixture = createTestD1(); });
afterEach(() => { fixture.raw.close(); });

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('overlapping invocations have one owner; failures release only their own lease', async () => {
  const started = gate(), finish = gate();
  const first = withScheduledWorkLease(fixture.db, 'daily', async lease => {
    expect(await lease.renew()).toBe(true);
    started.resolve();
    await finish.promise;
    return 'first';
  });
  await started.promise;
  let duplicateRan = false;
  expect(await withScheduledWorkLease(fixture.db, 'daily', async () => { duplicateRan = true; }))
    .toEqual({ acquired: false });
  expect(duplicateRan).toBe(false);
  finish.resolve();
  expect(await first).toEqual({ acquired: true, value: 'first' });
  await expect(withScheduledWorkLease(fixture.db, 'daily', async () => {
    throw new Error('work failed');
  })).rejects.toThrow('work failed');
  expect(await withScheduledWorkLease(fixture.db, 'daily', async () => 'retry'))
    .toEqual({ acquired: true, value: 'retry' });
});

test('expired work cannot renew or release its replacement owner', async () => {
  let clock = Date.parse('2026-10-23T00:00:00Z');
  const firstStarted = gate(), firstFinish = gate(), secondStarted = gate(), secondFinish = gate();
  const first = withScheduledWorkLease(fixture.db, 'daily', async lease => {
    firstStarted.resolve();
    await firstFinish.promise;
    expect(await lease.renew()).toBe(false);
  }, () => clock);
  await firstStarted.promise;
  clock += 21 * 60_000;
  const second = withScheduledWorkLease(fixture.db, 'daily', async lease => {
    secondStarted.resolve();
    await secondFinish.promise;
    expect(await lease.renew()).toBe(true);
  }, () => clock);
  await secondStarted.promise;
  const replacement = fixture.raw.prepare('SELECT value FROM platform_settings WHERE key=?')
    .get('scheduled-work:daily');
  firstFinish.resolve();
  await first;
  expect(fixture.raw.prepare('SELECT value FROM platform_settings WHERE key=?')
    .get('scheduled-work:daily')).toEqual(replacement);
  secondFinish.resolve();
  await second;
  expect(fixture.raw.prepare('SELECT value FROM platform_settings WHERE key=?')
    .get('scheduled-work:daily')).toBeUndefined();
});
