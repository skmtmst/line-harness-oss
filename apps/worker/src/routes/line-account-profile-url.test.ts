import { describe, expect, test } from 'vitest';
import { readOfficialProfileUrl } from './line-account-profile-url.js';

describe('readOfficialProfileUrl', () => {
  test.each([
    'https://lin.ee/nen-official',
    'https://line.me/R/ti/p/@nen-official',
    'https://lin.ee/nen-official?openExternalBrowser=1',
  ])('accepts an official profile URL: %s', (value) => {
    expect(readOfficialProfileUrl(` ${value} `)).toEqual({ ok: true, value });
  });

  test.each([
    'https://line.me/other-path',
    'https://line.me/R/ti/p/nen-official',
    'https://line.me/R/ti/p/@',
    'https://line.me/R/ti/prefix/@nen-official',
    'https://line.me/r/ti/p/@nen-official',
    'https://line.me/',
    'https://lin.ee/',
    'https://example.com/R/ti/p/@nen-official',
    'https://line.me.example.com/R/ti/p/@nen-official',
    'https://lin.ee.example.com/nen-official',
    'http://lin.ee/nen-official',
    'http://line.me/R/ti/p/@nen-official',
    'https://lin.ee:8443/nen-official',
    'https://line.me:8443/R/ti/p/@nen-official',
    'https://user@lin.ee/nen-official',
    'https://user@line.me/R/ti/p/@nen-official',
    'https://:password@lin.ee/nen-official',
    'https://:password@line.me/R/ti/p/@nen-official',
    'not a URL',
    123,
  ])('rejects an invalid profile URL: %s', (value) => {
    expect(readOfficialProfileUrl(value)).toEqual({
      ok: false,
      error: 'officialProfileUrl must be a https://lin.ee/ or https://line.me/R/ti/p/@ URL',
    });
  });

  test.each([undefined, null, '', '  '])('preserves omission and clearing: %s', (value) => {
    expect(readOfficialProfileUrl(value)).toEqual({
      ok: true,
      value: value === undefined ? undefined : null,
    });
  });
});
