import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLineToken } from './line-token.js';

describe('resolveLineToken', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the account token without logging', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(resolveLineToken({
      accountToken: 'account-secret-token',
      defaultToken: 'default-secret-token',
      accountId: 'account-1',
      context: 'test.account-token',
    })).toBe('account-secret-token');
    expect(log).not.toHaveBeenCalled();
  });

  it('returns the default token and logs one safe, attributable event', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const defaultToken = 'default-secret-token';

    expect(resolveLineToken({
      accountToken: null,
      defaultToken,
      accountId: null,
      context: 'test.default-fallback',
    })).toBe(defaultToken);
    expect(log).toHaveBeenCalledTimes(1);

    const event = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(event).toEqual({ code: 'line_token_default_fallback', timestamp: expect.any(String), level: 'info', requestId: null, invocationId: null, source: 'background' });
    expect(JSON.stringify(log.mock.calls)).not.toContain(defaultToken);
  });
});
