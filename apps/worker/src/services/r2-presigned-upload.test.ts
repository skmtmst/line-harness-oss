import { describe, expect, it } from 'vitest';
import { createR2PresignedPutUrl } from './r2-presigned-upload.js';

describe('R2 direct upload signing', () => {
  it('binds one PUT URL to the object, MIME and upload session for 15 minutes', async () => {
    const result = await createR2PresignedPutUrl({
      accountId: 'account-zone',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      bucketName: 'media bucket',
    }, {
      key: 'media/line-1/file name.png',
      contentType: 'image/png',
      lineAccountId: 'line-1',
      uploadSessionId: 'upload-1',
      now: new Date('2026-09-07T00:00:00.000Z'),
    });

    const url = new URL(result.url);
    expect(url.hostname).toBe('account-zone.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/media%20bucket/media/line-1/file%20name.png');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('x-amz-meta-upload-session-id');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(result.headers).toEqual({
      'Content-Type': 'image/png',
      'x-amz-meta-line-account-id': 'line-1',
      'x-amz-meta-upload-session-id': 'upload-1',
    });
    expect(result.expiresAt).toBe('2026-09-07T00:15:00.000Z');
    expect(result.url).not.toContain('secret-key');
  });
});
