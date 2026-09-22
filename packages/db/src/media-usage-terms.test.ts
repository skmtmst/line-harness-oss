import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMedia, getMediaById, updateMedia } from './media.js';
import { getMediaVersionByNo } from './media-uploads.js';

/*
 * IDEA-15 登録メディア。既知の利用期限・同意情報の記録と、
 * 版ごとの実体（元ファイルの取り戻し）へのアカウント境界。
 */

const packageRoot = join(import.meta.dirname, '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run())) as T;
    },
  } as unknown as D1Database;
}

function insertAccount(sqlite: Database.Database, id: string): void {
  sqlite.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(id, `channel-${id}`, id);
}

describe('IDEA-15 メディアの利用期限・同意の記録', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    insertAccount(sqlite, 'account-a');
    insertAccount(sqlite, 'account-b');
    db = asD1(sqlite);
  });

  async function seed() {
    const media = await createMedia(db, {
      kind: 'image',
      lineAccountId: 'account-a',
      filename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      r2Key: 'media/account-a/a.png',
    });
    return media.id;
  }

  it('登録直後は未記録（null）で、推測値は入らない', async () => {
    const id = await seed();
    const media = await getMediaById(db, id, 'account-a');
    expect(media?.usage_expires_at).toBeNull();
    expect(media?.usage_consent_note).toBeNull();
  });

  it('期限と同意メモを保存して読み戻せる', async () => {
    const id = await seed();
    await updateMedia(db, id, 'account-a', {
      usageExpiresAt: '2027-03-31',
      usageConsentNote: '出演者の同意書を確認済み',
    });
    const media = await getMediaById(db, id, 'account-a');
    expect(media?.usage_expires_at).toBe('2027-03-31');
    expect(media?.usage_consent_note).toBe('出演者の同意書を確認済み');
  });

  it('null で記録を消し、未記録＝不明へ戻す', async () => {
    const id = await seed();
    await updateMedia(db, id, 'account-a', {
      usageExpiresAt: '2027-03-31',
      usageConsentNote: '確認済み',
    });
    await updateMedia(db, id, 'account-a', { usageExpiresAt: null, usageConsentNote: null });
    const media = await getMediaById(db, id, 'account-a');
    expect(media?.usage_expires_at).toBeNull();
    expect(media?.usage_consent_note).toBeNull();
  });

  it('名前だけの変更は記録を残す（指定しない項目は触らない）', async () => {
    const id = await seed();
    await updateMedia(db, id, 'account-a', { usageExpiresAt: '2027-03-31' });
    await updateMedia(db, id, 'account-a', { filename: 'b.png' });
    const media = await getMediaById(db, id, 'account-a');
    expect(media?.filename).toBe('b.png');
    expect(media?.usage_expires_at).toBe('2027-03-31');
  });

  it('他アカウントのメディアへは書き込めない', async () => {
    const id = await seed();
    const result = await updateMedia(db, id, 'account-b', { usageExpiresAt: '2027-03-31' });
    expect(result).toBeNull();
    const media = await getMediaById(db, id, 'account-a');
    expect(media?.usage_expires_at).toBeNull();
  });
});

describe('IDEA-15 版ごとの実体の取り出し', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    insertAccount(sqlite, 'account-a');
    insertAccount(sqlite, 'account-b');
    db = asD1(sqlite);
  });

  it('第1版（登録時の元ファイル）を版番号で引ける', async () => {
    const media = await createMedia(db, {
      kind: 'image',
      lineAccountId: 'account-a',
      filename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      r2Key: 'media/account-a/original.png',
    });
    const version = await getMediaVersionByNo(db, media.id, 'account-a', 1);
    expect(version?.version_no).toBe(1);
    expect(version?.r2_key).toBe('media/account-a/original.png');
    expect(version?.mime_type).toBe('image/png');
  });

  it('存在しない版はnull', async () => {
    const media = await createMedia(db, {
      kind: 'image',
      lineAccountId: 'account-a',
      filename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      r2Key: 'media/account-a/a.png',
    });
    expect(await getMediaVersionByNo(db, media.id, 'account-a', 9)).toBeNull();
  });

  it('他アカウントのメディアの版は引けない', async () => {
    const media = await createMedia(db, {
      kind: 'image',
      lineAccountId: 'account-a',
      filename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      r2Key: 'media/account-a/a.png',
    });
    expect(await getMediaVersionByNo(db, media.id, 'account-b', 1)).toBeNull();
  });
});
