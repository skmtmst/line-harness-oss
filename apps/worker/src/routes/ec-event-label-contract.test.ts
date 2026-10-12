import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = readFileSync(join(HERE, 'ec-commerce.ts'), 'utf8');
const WEB = readFileSync(join(HERE, '../../../web/src/v8/settings/ec-commerce/screen.tsx'), 'utf8');
const CONNECTOR = readFileSync(join(HERE, '../../../web/src/v8/settings/ec-commerce/connector.tsx'), 'utf8');

describe('EC event label drift guard (#600)', () => {
  it('WebとWorkerが共有契約から表示名を読む', () => {
    expect(WORKER).toContain('ecEventLabel');
    expect(WEB).toContain('ecEventLabel');
    expect(CONNECTOR).toContain('EC_EVENT_LABELS');
    expect(WORKER).not.toMatch(/const EVENT_LABELS\s*:/);
    expect(WEB).not.toMatch(/const EVENT_LABEL\s*:/);
  });
});
