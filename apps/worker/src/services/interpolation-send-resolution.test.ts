/*
 * N-189: 送信経路の共通情報解決が fail-closed であることを、実SQLite
 * （bootstrap.sql）で確かめる。
 *
 * 消えた共通情報を空文字へ落とすと「営業時間: 」のような意味の壊れた
 * 本文がそのままお客様へ届く。削除済み・未知・期限切れで代替なしの
 * 共通情報が1つでもあれば LINE 送信は0件になり、変数名と理由が台帳へ残る。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  resolveSendInterpolationExtra,
  resolveSendCommonVars,
  CommonVarResolutionFailedError,
} from './interpolation-context.js';

let sqlite: SqliteD1;
let db: D1Database;

function seed(): void {
  const raw = sqlite.raw;
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  for (const id of ['acc-1', 'acc-2']) {
    raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, 'tenant-1')`,
    ).run(id, `channel-${id}`, id);
  }
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id) VALUES ('fr-1', 'U-1', '利用者1', 'acc-1')`,
  ).run();
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id) VALUES ('fr-no-acct', 'U-9', '所属なし', NULL)`,
  ).run();
}

function insertVar(input: {
  id: string;
  accountId?: string;
  key: string;
  value: string;
  fallbackValue?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  expiryBehavior?: 'stop' | 'fallback';
  archivedAt?: string | null;
}): void {
  sqlite.raw.prepare(`
    INSERT INTO common_vars
      (id, line_account_id, name, var_key, type, value, fallback_value,
       valid_from, valid_until, expiry_behavior, version, archived_at)
    VALUES (?, ?, ?, ?, 'text', ?, ?, ?, ?, ?, 1, ?)
  `).run(
    input.id,
    input.accountId ?? 'acc-1',
    input.key,
    input.key,
    input.value,
    input.fallbackValue ?? null,
    input.validFrom ?? null,
    input.validUntil ?? null,
    input.expiryBehavior ?? 'stop',
    input.archivedAt ?? null,
  );
}

function ledgerRows(): Array<{
  line_account_id: string;
  source_kind: string;
  source_id: string;
  var_key: string;
  reason: string;
  retryable: number;
  execution_at: string;
}> {
  return sqlite.raw.prepare(
    `SELECT line_account_id, source_kind, source_id, var_key, reason, retryable, execution_at
       FROM common_var_resolution_failures ORDER BY created_at`,
  ).all() as never;
}

beforeEach(() => {
  sqlite = createTestD1();
  db = sqlite.db;
  seed();
});

describe('送信経路の共通情報解決(N-189)', () => {
  it('定義済みの共通情報は値を返す', async () => {
    insertVar({ id: 'v-1', key: 'hours', value: '10時から18時' });
    const extra = await resolveSendInterpolationExtra(
      db, 'fr-1', '営業時間は{{var.hours}}です', { kind: 'scenario', id: 'fs-1' },
    );
    expect(extra.vars).toEqual({ hours: '10時から18時' });
    expect(ledgerRows()).toHaveLength(0);
  });

  it('未知の共通情報は空文字にせず止め、台帳へ変数名と理由を残す', async () => {
    await expect(resolveSendInterpolationExtra(
      db, 'fr-1', '前{{var.deleted_key}}後', { kind: 'scenario', id: 'fs-1' },
    )).rejects.toBeInstanceOf(CommonVarResolutionFailedError);
    const rows = ledgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      line_account_id: 'acc-1',
      source_kind: 'scenario',
      source_id: 'fs-1',
      var_key: 'deleted_key',
      reason: 'missing',
      // 修復後に重複なく再試行できる失敗であることも台帳へ残す。
      retryable: 1,
    });
  });

  it('削除済み（アーカイブ）の共通情報は missing として止める', async () => {
    insertVar({ id: 'v-arc', key: 'old_var', value: '昔の値', archivedAt: '2026-09-01T00:00:00.000Z' });
    const error = await resolveSendInterpolationExtra(
      db, 'fr-1', '{{var.old_var}}', { kind: 'reminder', id: 'step-1' },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommonVarResolutionFailedError);
    expect((error as CommonVarResolutionFailedError).failures[0].reason).toBe('missing');
    expect(ledgerRows()[0]?.var_key).toBe('old_var');
  });

  it('期限切れで代替なしの共通情報は expired として止める', async () => {
    insertVar({
      id: 'v-exp', key: 'campaign', value: '開催中',
      validUntil: '2026-09-01T00:00:00.000Z', expiryBehavior: 'stop',
    });
    const error = await resolveSendInterpolationExtra(
      db, 'fr-1', '{{var.campaign}}', { kind: 'scenario', id: 'fs-1' },
      '2026-09-10T00:00:00.000Z',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommonVarResolutionFailedError);
    expect((error as CommonVarResolutionFailedError).failures[0]).toMatchObject({
      varKey: 'campaign', reason: 'expired',
    });
  });

  it('期限切れでも代替値があれば代替値で送れる', async () => {
    insertVar({
      id: 'v-fb', key: 'campaign', value: '開催中', fallbackValue: '受付期間外',
      validUntil: '2026-09-01T00:00:00.000Z', expiryBehavior: 'fallback',
    });
    const extra = await resolveSendInterpolationExtra(
      db, 'fr-1', '{{var.campaign}}', { kind: 'scenario', id: 'fs-1' },
      '2026-09-10T00:00:00.000Z',
    );
    expect(extra.vars).toEqual({ campaign: '受付期間外' });
    expect(ledgerRows()).toHaveLength(0);
  });

  it('別アカウントの同名の値へは逃げない', async () => {
    insertVar({ id: 'v-other', accountId: 'acc-2', key: 'shop_name', value: '別店舗' });
    const error = await resolveSendInterpolationExtra(
      db, 'fr-1', '{{var.shop_name}}', { kind: 'auto_reply', id: 'rule-1' },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommonVarResolutionFailedError);
    expect(ledgerRows()[0]?.line_account_id).toBe('acc-1');
  });

  it('アカウント未所属の友だちでは共通情報を解決せず止める', async () => {
    insertVar({ id: 'v-1', key: 'hours', value: '10時から18時' });
    await expect(resolveSendInterpolationExtra(
      db, 'fr-no-acct', '{{var.hours}}', { kind: 'scenario', id: 'fs-1' },
    )).rejects.toBeInstanceOf(CommonVarResolutionFailedError);
  });

  it('修復後は同じ送信元で再試行できる', async () => {
    const content = '営業時間: {{var.hours}}';
    await expect(resolveSendInterpolationExtra(
      db, 'fr-1', content, { kind: 'chat', id: 'fr-1' },
    )).rejects.toBeInstanceOf(CommonVarResolutionFailedError);
    // 運用者が共通情報を作り直すと、同じ送信はそのまま通る。
    insertVar({ id: 'v-fix', key: 'hours', value: '9時から17時' });
    const extra = await resolveSendInterpolationExtra(
      db, 'fr-1', content, { kind: 'chat', id: 'fr-1' },
    );
    expect(extra.vars).toEqual({ hours: '9時から17時' });
  });

  it('共通情報を使わない本文はクエリを増やさない', async () => {
    const extra = await resolveSendInterpolationExtra(
      db, 'fr-1', 'ただの本文', { kind: 'scenario', id: 'fs-1' },
    );
    expect(extra).toEqual({});
  });

  it('アカウントが分かる経路（配信・テスト送信）も同じ判定を通る', async () => {
    const error = await resolveSendCommonVars(
      db, 'acc-1', '{{var.missing}}', { kind: 'broadcast', id: 'bc-1' },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommonVarResolutionFailedError);
    expect(ledgerRows()[0]).toMatchObject({ source_kind: 'broadcast', source_id: 'bc-1' });
  });
});
