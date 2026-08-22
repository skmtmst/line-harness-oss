import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('予約メール原文の環境分離', () => {
  it('本番と検証で別の非公開R2バインディングを使う', () => {
    const production = readFileSync(join(workerRoot, 'wrangler.toml'), 'utf8');
    const staging = readFileSync(join(workerRoot, 'wrangler.staging.toml'), 'utf8');

    expect(production).toContain('binding = "RAW_MAIL"\nbucket_name = "musubo-raw-mail"');
    expect(staging).toContain('binding = "RAW_MAIL"\nbucket_name = "musubo-raw-mail-stg"');
    expect(production).toContain('binding = "IMAGES"\nbucket_name = "nen-line-images"');
    expect(staging).toContain('binding = "IMAGES"\nbucket_name = "nen-line-stg-images"');
  });

  it('本番の取り込みドメインを検証設定へ流用しない', () => {
    const production = readFileSync(join(workerRoot, 'wrangler.toml'), 'utf8');
    const staging = readFileSync(join(workerRoot, 'wrangler.staging.toml'), 'utf8');

    expect(production).toMatch(/^RESTAURANT_INTAKE_DOMAIN = "r\.musubo\.jp"$/m);
    expect(staging).not.toMatch(/^RESTAURANT_INTAKE_DOMAIN\s*=/m);
  });
});
