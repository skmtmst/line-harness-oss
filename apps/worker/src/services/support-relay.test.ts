import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendViaXServerRelay, signSupportRelay } from './support-relay.js';

const relayUrl = 'https://mail.example.test/support-relay.php';
const secret = 'relay-test-secret';
const message = {
  to: 'recipient@example.test', subject: '相談', body: 'メール本文',
  fromName: '窓口', inReplyTo: '<previous@example.test>', references: '<first@example.test>',
};
const success = () => Response.json({ success: true, messageId: 'message-1' });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('support relay transport safety (F05)', () => {
  it('keeps the configured destination, signed raw body and all mail fields', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_790_000_000_123);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(success());
    vi.stubGlobal('fetch', transport);
    await expect(sendViaXServerRelay(relayUrl, secret, message)).resolves.toBe('message-1');
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(relayUrl);
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', body: JSON.stringify(message) });
    expect(init?.headers).toEqual({
      'content-type': 'application/json', 'x-nen-timestamp': '1790000000',
      'x-nen-signature': await signSupportRelay(secret, '1790000000', JSON.stringify(message)),
    });
  });

  it.each([301, 302, 303, 307, 308])('does not forward the signed mail on HTTP %i', async (status) => {
    const forwarded = vi.fn();
    const redirected = new Response(null, { status, headers: { location: 'https://other.example.test/mail' } });
    // 模擬transportは自動転送が有効なら漏えいを再現する。実通信はしない。
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.redirect !== 'manual') {
        forwarded(init?.body, init?.headers);
        return success();
      }
      return redirected;
    });
    vi.stubGlobal('fetch', transport);
    await expect(sendViaXServerRelay(relayUrl, secret, message))
      .rejects.toThrow(`XSERVER_RELAY_FAILED:${status}:redirect`);
    expect(forwarded).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(['opaqueredirect', 'already-followed'] as const)('rejects %s before reading its body', async (kind) => {
    const response = success();
    Object.defineProperty(response, kind === 'opaqueredirect' ? 'type' : 'redirected', {
      value: kind === 'opaqueredirect' ? 'opaqueredirect' : true,
    });
    const json = vi.spyOn(response, 'json');
    const cancel = vi.spyOn(response.body!, 'cancel');
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal('fetch', transport);
    await expect(sendViaXServerRelay(relayUrl, secret, message)).rejects.toThrow('XSERVER_RELAY_FAILED:200:redirect');
    expect(json).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    [502, { success: false, error: 'unavailable' }, 'XSERVER_RELAY_FAILED:502:unavailable'],
    [200, { success: false }, 'XSERVER_RELAY_FAILED:200:unknown'],
    [200, { success: true }, 'XSERVER_RELAY_FAILED:200:unknown'],
  ] as const)('keeps relay failure %i without retrying', async (status, body, error) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
    vi.stubGlobal('fetch', transport);
    await expect(sendViaXServerRelay(relayUrl, secret, message)).rejects.toThrow(error);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('keeps malformed JSON as a failed response', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('invalid json')));
    await expect(sendViaXServerRelay(relayUrl, secret, message)).rejects.toThrow('XSERVER_RELAY_FAILED:200:unknown');
  });

  it('does not retry an unknown network result or log mail/signatures', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('connection lost'));
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    vi.stubGlobal('fetch', transport);
    await expect(sendViaXServerRelay(relayUrl, secret, message)).rejects.toThrow('connection lost');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({ code: 'external.request.failed', timestamp: expect.any(String), level: 'warn', requestId: null, invocationId: null, source: 'background', durationMs: expect.any(Number) });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/mail|signature|connection lost/);
    expect(error).not.toHaveBeenCalled();
  });
});
