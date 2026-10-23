import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { restaurantTestEnabled } from '../lib/environment-features.js';
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

  it('設定がtrueでも本番は閉じ、検証だけAPIと画面のフラグが有効になる', () => {
    const repoRoot = join(workerRoot, '../..');
    const production = readFileSync(join(workerRoot, 'wrangler.toml'), 'utf8');
    const staging = readFileSync(join(workerRoot, 'wrangler.staging.toml'), 'utf8');
    const stagingWorkflow = readFileSync(join(repoRoot, '.github/workflows/deploy-cloudflare-staging.yml'), 'utf8');
    const configured = (source: string) => ({
      DEPLOY_ENV: source.match(/^DEPLOY_ENV = "([^"]+)"$/m)?.[1],
      RESTAURANT_TEST_ENABLED: source.match(/^RESTAURANT_TEST_ENABLED = "([^"]+)"$/m)?.[1],
    });
    expect(restaurantTestEnabled(configured(production))).toBe(false);
    expect(restaurantTestEnabled(configured(staging))).toBe(true);
    expect(stagingWorkflow).toMatch(/^\s*NEXT_PUBLIC_RESTAURANT_TEST_ENABLED: 'true'$/m);
  });

  // 予約メール原文の取り込みは検証だけ。ここは環境を分けたままにする。
  it('Googleへの書き込みは環境ごとのスイッチで切り替える', () => {
    const production = readFileSync(join(workerRoot, 'wrangler.toml'), 'utf8');
    const staging = readFileSync(join(workerRoot, 'wrangler.staging.toml'), 'utf8');

    expect(production).toMatch(/^GOOGLE_BUSINESS_WRITE_ENABLED = "(true|false)"$/m);
    expect(staging).toMatch(/^GOOGLE_BUSINESS_WRITE_ENABLED = "(true|false)"$/m);
    // 認可に使う値は設定ファイルに置かず、環境ごとのシークレットとして登録する。
    expect(production).not.toMatch(/^GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET\s*=/m);
    expect(staging).not.toMatch(/^GOOGLE_BUSINESS_OAUTH_CLIENT_SECRET\s*=/m);
  });

  it('メール原文を一括で文字列・バッファへ展開する処理を置かない', () => {
    const intakeSource = readFileSync(join(workerRoot, 'src/services/restaurant-email-intake.ts'), 'utf8');

    expect(intakeSource).not.toContain('new Response(message.raw).arrayBuffer()');
    expect(intakeSource).not.toContain('new Response(message.raw).text()');
  });
});
