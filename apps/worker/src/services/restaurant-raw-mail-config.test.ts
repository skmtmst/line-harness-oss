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

  // Googleの機密スコープ審査（デモ動画と実運用）のため、飲食店向けは両環境で有効。
  // 分離したままにするのは予約メールの取り込み一式（RESTAURANT_INTAKE_DOMAIN と
  // RAW_MAIL）だけで、そこは上の2つの試験が見張っている。
  // ここで守るのは「APIと画面のフラグがずれていないこと」。片方だけ有効だと
  // 画面はあるのにAPIが404、またはAPIはあるのに画面が無い状態になる。
  it('飲食店向けのフラグはAPIと管理画面で同じ値にする', () => {
    const repoRoot = join(workerRoot, '../..');
    const production = readFileSync(join(workerRoot, 'wrangler.toml'), 'utf8');
    const staging = readFileSync(join(workerRoot, 'wrangler.staging.toml'), 'utf8');
    const adminWorkflow = readFileSync(join(repoRoot, '.github/workflows/deploy-cloudflare-admin.yml'), 'utf8');
    const stagingWorkflow = readFileSync(join(repoRoot, '.github/workflows/deploy-cloudflare-staging.yml'), 'utf8');

    expect(production).toMatch(/^RESTAURANT_TEST_ENABLED = "true"$/m);
    expect(staging).toMatch(/^RESTAURANT_TEST_ENABLED = "true"$/m);
    expect(adminWorkflow).toMatch(/^\s*NEXT_PUBLIC_RESTAURANT_TEST_ENABLED: 'true'$/m);
    expect(stagingWorkflow).toMatch(/^\s*NEXT_PUBLIC_RESTAURANT_TEST_ENABLED: 'true'$/m);
  });

  // Googleへ実際に公開するかは環境ごとに切り替える。検証では false のまま使う。
  it('Googleへの書き込みは環境ごとのスイッチで切り替える', () => {
    const production = readFileSync(join(workerRoot, 'wrangler.toml'), 'utf8');
    const staging = readFileSync(join(workerRoot, 'wrangler.staging.toml'), 'utf8');

    expect(production).toMatch(/^GOOGLE_BUSINESS_WRITE_ENABLED = "(true|false)"$/m);
    expect(staging).toMatch(/^GOOGLE_BUSINESS_WRITE_ENABLED = "(true|false)"$/m);
    // 認可に使う値は設定ファイルに置かず、環境ごとのシークレットとして登録する。
    expect(production).not.toMatch(/^GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET\s*=/m);
    expect(staging).not.toMatch(/^GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET\s*=/m);
  });

  it('メール原文をメモリ展開せず、rawSize付きストリームでR2へ渡す', () => {
    const intakeSource = readFileSync(join(workerRoot, 'src/services/restaurant-email-intake.ts'), 'utf8');

    expect(intakeSource).toContain('new FixedLengthStream(message.rawSize)');
    expect(intakeSource).toContain('message.raw.pipeTo(fixedLength.writable');
    expect(intakeSource).not.toContain('new Response(message.raw).arrayBuffer()');
    expect(intakeSource).not.toContain('new Response(message.raw).text()');
  });
});
