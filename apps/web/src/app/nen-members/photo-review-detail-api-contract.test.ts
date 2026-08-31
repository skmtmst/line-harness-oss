import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const api = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8');

describe('V6 photo review detail API contract', () => {
  it('loads one photo inside the selected LINE account', () => {
    expect(api).toContain('photo: (id: string, accountId: string)');
    expect(api).toContain('/api/nen-members/photos/${encodeURIComponent(id)}?accountId=${encodeURIComponent(accountId)}');
  });

  it('keeps unavailable safety facts distinct from successful checks', () => {
    expect(api).toContain("source: 'legacy_submission_url'");
    expect(api).toContain('derivativeAvailable: false');
    expect(api).toContain("state: 'unavailable'");
    expect(api).toContain('canDownloadOriginal: false');
    expect(api).toContain('canPublish: false');
  });

  it('sends the revision back when a reviewer decides', () => {
    expect(api).toContain('expectedRevision?: string');
    expect(api).toContain('revision: string');
  });
});
