import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicHttpsRequest, formWebhookTarget } from './public-https-request.js';

afterEach(() => vi.unstubAllGlobals());
describe('fixed-origin public requests', () => {
  it.each(['https://{host}/path', 'https://{host}.example.com/', 'https://user:{password}@example.com/', 'http://example.com/'])('rejects authority templates %s', template => {
    expect(() => formWebhookTarget(template, { host: 'evil.test', password: 'x' })).toThrow();
  });
  it('encodes path/query answers and keeps repeated substitutions within origin', () => {
    const url = new URL(formWebhookTarget('https://example.com/{answer}?q={answer}', { answer: '//evil.test/?x=#' }));
    expect(url.origin).toBe('https://example.com');
    expect(url.searchParams.get('q')).toBe('//evil.test/?x=#');
  });
  it.each([[['10.0.0.1']], [['93.184.216.34', '::1']], [[]], [['::ffff:127.0.0.1']]] as [string[]][])('does not send to unsafe DNS results %j', async addresses => {
    const send = vi.fn();
    await expect(publicHttpsRequest('https://example.com', {}, { lookupHost: async () => addresses, fetchImpl: send })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects DNS changes between checks', async () => {
    const lookup = vi.fn().mockResolvedValueOnce(['93.184.216.34']).mockResolvedValueOnce(['8.8.8.8']);
    const send = vi.fn();
    await expect(publicHttpsRequest('https://example.com', {}, { lookupHost: lookup, fetchImpl: send })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it('sends once with manual redirects to stable public DNS', async () => {
    const send = vi.fn(async () => new Response(null, { status: 307 }));
    await publicHttpsRequest('https://example.com', { method: 'HEAD' }, { lookupHost: async () => ['93.184.216.34'], fetchImpl: send });
    expect(send).toHaveBeenCalledExactlyOnceWith('https://example.com', { method: 'HEAD', redirect: 'manual' });
  });
});


it.each(['.', '..'])('F28: cannot normalize answer %s into a parent path', answer => {
  expect(() => formWebhookTarget('https://partner.test/members/{member}/eligibility', { member: answer })).toThrow('unsafe_destination');
  expect(new URL(formWebhookTarget('https://partner.test/check?q={member}', { member: answer })).searchParams.get('q')).toBe(answer);
  expect(formWebhookTarget('https://partner.test/files/{member}.json', { member: answer })).toContain('.json');
});
it('F28: adjacent template characters cannot turn answers into a dot segment', () => {
  expect(() => formWebhookTarget('https://partner.test/members/{member}./check', { member: '.' })).toThrow();
  expect(() => formWebhookTarget('https://partner.test/members/{member}.%2e/check', { member: '' })).toThrow();
});
