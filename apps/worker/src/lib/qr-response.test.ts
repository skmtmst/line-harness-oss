import { describe, expect, it } from 'vitest';
import { qrResponseHeaders } from './qr-response.js';

describe('qrResponseHeaders', () => {
  it('displays QR images inline by default', () => {
    expect(qrResponseHeaders('image/png', false, '')).toEqual({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    });
  });

  it('downloads a safely named PNG when requested', () => {
    expect(qrResponseHeaders(null, true, '../A店 referral')).toMatchObject({
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="---A--referral.png"',
    });
  });
});
