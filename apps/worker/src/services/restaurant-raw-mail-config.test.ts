import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('予約メール原文の環境分離', () => {
  it('予約メール原文のR2は検証だけにバインドする', () => {
    const production = readFileSync(join(workerRoot, 'wrangler.toml'), 'utf8');
    const staging = readFileSync(join(workerRoot, 'wrangler.staging.toml'), 'utf8');

    expect(production).not.toContain('binding = "RAW_MAIL"');
    expect(production).not.toContain('bucket_name = "musubo-raw-mail"');
    expect(staging).toContain('binding = "RAW_MAIL"\nbucket_name = "musubo-raw-mail-stg"');
    expect(production).toContain('binding = "IMAGES"\nbucket_name = "nen-line-images"');
    expect(staging).toContain('binding = "IMAGES"\nbucket_name = "nen-line-stg-images"');
  });

  it('予約メール取り込みドメインは検証だけに設定する', () => {
    const production = readFileSync(join(workerRoot, 'wrangler.toml'), 'utf8');
    const staging = readFileSync(join(workerRoot, 'wrangler.staging.toml'), 'utf8');

    expect(production).not.toMatch(/^RESTAURANT_INTAKE_DOMAIN\s*=/m);
    expect(staging).toMatch(/^RESTAURANT_INTAKE_DOMAIN = "rs\.musubo\.jp"$/m);
  });

  // 飲食店向け機能そのものは本番でも使う（Googleビジネスを本番へ出したため）。
  // 分離したままにするのは予約メールの取り込み一式（RESTAURANT_INTAKE_DOMAIN と
  // RAW_MAIL）だけで、そこは上の2つの試験が見張っている。
  // RAW_MAIL は参照箇所すべてが未設定を見て止まるので、本番で機能を有効にしても
  // 取り込み経路が動き出すことはない。
  it('飲食店向け機能は本番・検証の両方で明示的に有効にする', () => {
    const production = readFileSync(join(workerRoot, 'wrangler.toml'), 'utf8');
    const staging = readFileSync(join(workerRoot, 'wrangler.staging.toml'), 'utf8');

    expect(production).toMatch(/^RESTAURANT_TEST_ENABLED = "true"$/m);
    expect(staging).toMatch(/^RESTAURANT_TEST_ENABLED = "true"$/m);
  });

  it('メール原文をメモリ展開せず、rawSize付きストリームでR2へ渡す', () => {
    const intakeSource = readFileSync(join(workerRoot, 'src/services/restaurant-email-intake.ts'), 'utf8');

    expect(intakeSource).toContain('new FixedLengthStream(message.rawSize)');
    expect(intakeSource).toContain('message.raw.pipeTo(fixedLength.writable');
    expect(intakeSource).not.toContain('new Response(message.raw).arrayBuffer()');
    expect(intakeSource).not.toContain('new Response(message.raw).text()');
  });
});
