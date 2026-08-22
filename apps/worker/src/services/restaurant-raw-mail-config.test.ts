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

  it('本番と検証で別の取り込みドメインを使う', () => {
    const production = readFileSync(join(workerRoot, 'wrangler.toml'), 'utf8');
    const staging = readFileSync(join(workerRoot, 'wrangler.staging.toml'), 'utf8');

    expect(production).toMatch(/^RESTAURANT_INTAKE_DOMAIN = "r\.musubo\.jp"$/m);
    expect(staging).toMatch(/^RESTAURANT_INTAKE_DOMAIN = "rs\.musubo\.jp"$/m);
  });

  it('メール原文をメモリ展開せず、rawSize付きストリームでR2へ渡す', () => {
    const intakeSource = readFileSync(join(workerRoot, 'src/services/restaurant-email-intake.ts'), 'utf8');

    expect(intakeSource).toContain('new FixedLengthStream(message.rawSize)');
    expect(intakeSource).toContain('message.raw.pipeTo(fixedLength.writable');
    expect(intakeSource).not.toContain('new Response(message.raw).arrayBuffer()');
    expect(intakeSource).not.toContain('new Response(message.raw).text()');
  });
});
