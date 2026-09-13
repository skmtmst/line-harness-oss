import { describe, expect, test } from 'vitest';
import { AsyncTestScope } from './async-test-scope.js';

describe('test timeout cleanup ownership', () => {
  test('releases fake I/O and drains the whole body before the next fixture starts', async () => {
    const scope = new AsyncTestScope();
    const gate = scope.gate(() => 'teardown');
    const events: string[] = [];
    const body = scope.run(async () => {
      events.push(await gate.promise);
      await Promise.resolve();
      events.push('body finally');
    });
    await scope.dispose();
    events.push('next fixture');
    expect(events).toEqual(['teardown', 'body finally', 'next fixture']);
    await body;
  });

  test('also drains requests left behind by an early body failure', async () => {
    const scope = new AsyncTestScope();
    const gate = scope.gate(() => undefined);
    let sent = false;
    const request = scope.track(gate.promise.then(async () => {
      await Promise.resolve();
      sent = true;
    }));
    const body = scope.run(async () => { throw new Error('original assertion'); });
    await expect(body).rejects.toThrow('original assertion');
    await scope.dispose();
    expect(sent).toBe(true);
    await request;
  });

  test('a gate created while teardown is draining cannot leave more paused work', async () => {
    const scope = new AsyncTestScope();
    const first = scope.gate(() => 1);
    const body = scope.run(async () => {
      await first.promise;
      return await scope.gate(() => 2).promise;
    });
    await scope.dispose();
    await expect(body).resolves.toBe(2);
  });
});
