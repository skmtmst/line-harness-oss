import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const api = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8');

describe('V6 photo publications API contract', () => {
  it('loads published photos inside the selected LINE account', () => {
    expect(api).toContain('photoPublications: (accountId: string)');
    expect(api).toContain('/api/nen-members/photo-publications?accountId=${encodeURIComponent(accountId)}');
  });

  it('keeps measured zero separate from unavailable counts', () => {
    expect(api).toContain('displayCount: number | null');
    expect(api).toContain("measurementState: 'measured' | 'unavailable'");
    expect(api).toContain('totalDisplayCount: number | null');
  });

  it('does not promise unsupported placement or withdrawal actions', () => {
    expect(api).toContain('canChangePlacement: false');
    expect(api).toContain('canWithdraw: false');
  });

  it('only returns a public derivative as a renderable image', () => {
    expect(api).toContain("state: 'ready'; url: string; version: string");
    expect(api).toContain("state: 'unavailable'; url: null; version: null");
  });
});
