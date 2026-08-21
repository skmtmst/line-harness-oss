import { describe, expect, test, vi } from 'vitest';
import { signSlackRequest, verifySlackRequest } from './slack-signature.js';

describe('Slack request signature', () => {
  test('正しい署名だけを受け入れる', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T01:00:00.000Z'));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = 'payload=%7B%22type%22%3A%22block_actions%22%7D';
    const signature = await signSlackRequest('slack-signing-secret', timestamp, body);
    await expect(verifySlackRequest('slack-signing-secret', timestamp, signature, body)).resolves.toBe(true);
    await expect(verifySlackRequest('slack-signing-secret', timestamp, signature, `${body}x`)).resolves.toBe(false);
    vi.useRealTimers();
  });

  test('5分を超えたリプレイを拒否する', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T01:10:00.000Z'));
    const timestamp = String(Math.floor(new Date('2026-08-21T01:00:00.000Z').getTime() / 1000));
    const body = 'payload=%7B%7D';
    const signature = await signSlackRequest('slack-signing-secret', timestamp, body);
    await expect(verifySlackRequest('slack-signing-secret', timestamp, signature, body)).resolves.toBe(false);
    vi.useRealTimers();
  });
});
