import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMedia, getMediaById } from './media.js';
import {
  MediaVersionConflictError,
  MediaVersionIncompatibleError,
  backfillMediaVersionMetadata,
  completeNewMediaUpload,
  createMediaUploadSession,
  createMediaVersionFromUpload,
  evaluateMediaVersionCompat,
  getLatestMediaVersion,
  getMediaUploadSession,
  verifyMediaUploadSession,
} from './media-uploads.js';

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

let seq = 0;

function sessionInput(overrides: Partial<Parameters<typeof createMediaUploadSession>[1]> = {}) {
  seq += 1;
  return {
    id: `up-${seq}`,
    lineAccountId: 'account-a',
    filename: `f-${seq}.png`,
    kind: 'image' as const,
    mimeType: 'image/png',
    sizeBytes: 100,
    r2Key: `media/account-a/f-${seq}.png`,
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 実測込みで verified まで進めたセッションを返す。 */
async function verifiedSession(
  db: D1Database,
  overrides: Partial<Parameters<typeof createMediaUploadSession>[1]> = {},
  measured?: { width: number | null; height: number | null } | null,
) {
  const input = sessionInput(overrides);
  await createMediaUploadSession(db, input);
  const overwrite = input.kind === 'image';
  const session = await verifyMediaUploadSession(
    db, input.id, input.lineAccountId, `etag-${input.id}`,
    overwrite
      ? { width: measured?.width ?? null, height: measured?.height ?? null }
      : undefined,
    overwrite,
  );
  return session!;
}

describe('メディアのアップロード予約と版の内容情報', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    insertAccount(sqlite, 'account-a');
    insertAccount(sqlite, 'account-b');
    db = asD1(sqlite);
  });

  it('予約へ内容情報を保存し、新規メディアと初版へ実測値を引き継ぐ', async () => {
    const session = await verifiedSession(db, {
      metadata: { width: 10, height: 20 },
    }, { width: 640, height: 480 });

    // 画像は実測値が正本なので申告(10x20)ではなく実測(640x480)が残る
    expect(session).toMatchObject({ width: 640, height: 480, status: 'verified' });

    const media = await completeNewMediaUpload(db, session);
    expect(media).toMatchObject({ width: 640, height: 480 });
    const version = await getLatestMediaVersion(db, media.id, 'account-a');
    expect(version).toMatchObject({ version_no: 1, width: 640, height: 480 });
  });

  it('画像の実測に失敗したら申告値を残さず寸法をnullへ戻す', async () => {
    const session = await verifiedSession(db, {
      metadata: { width: 640, height: 480 },
    }, null);

    expect(session.width).toBeNull();
    expect(session.height).toBeNull();
  });

  it('動画・音声は申告の長さを保持し、実測があれば実測で埋める', async () => {
    const declared = await createMediaUploadSession(db, sessionInput({
      filename: 'a.mp4', kind: 'video', mimeType: 'video/mp4',
      metadata: { duration_ms: 5000, codec: 'avc1' },
    }));
    const session = await verifyMediaUploadSession(
      db, declared.id, 'account-a', 'etag-1', undefined,
    );
    expect(session).toMatchObject({ duration_ms: 5000, codec: 'avc1' });
  });

  it('同じ内容情報なら第2版を書き込み、版・メディア両方へ記録する', async () => {
    const first = await verifiedSession(db, {}, { width: 100, height: 50 });
    const media = await completeNewMediaUpload(db, first);

    const next = await verifiedSession(db, {
      targetMediaId: media.id, filename: 'b.png',
    }, { width: 100, height: 50 });

    const version = await createMediaVersionFromUpload(db, {
      mediaId: media.id,
      lineAccountId: 'account-a',
      uploadSessionId: next.id,
      expectedVersionNo: 1,
      changeReason: '色味を更新',
    });

    expect(version).toMatchObject({
      version_no: 2, width: 100, height: 50, change_reason: '色味を更新',
    });
    const updated = await getMediaById(db, media.id, 'account-a');
    expect(updated).toMatchObject({ width: 100, height: 50, filename: 'b.png' });
  });

  it('寸法が違う版追加は互換性エラーで拒否し、版もメディアも変わらない', async () => {
    const first = await verifiedSession(db, {}, { width: 100, height: 50 });
    const media = await completeNewMediaUpload(db, first);
    const next = await verifiedSession(db, {
      targetMediaId: media.id,
    }, { width: 200, height: 50 });

    const error = await createMediaVersionFromUpload(db, {
      mediaId: media.id,
      lineAccountId: 'account-a',
      uploadSessionId: next.id,
      expectedVersionNo: 1,
      changeReason: '差し替え',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(MediaVersionIncompatibleError);
    expect((error as MediaVersionIncompatibleError).blockers).toEqual(['incompatible_dimensions']);
    expect((await getLatestMediaVersion(db, media.id, 'account-a'))?.version_no).toBe(1);
    expect((await getMediaById(db, media.id, 'account-a'))?.filename).toBe(media.filename);
  });

  it('内容情報が足りない版追加は「判定材料不足」として拒否する', async () => {
    const first = await verifiedSession(db, {}, { width: 100, height: 50 });
    const media = await completeNewMediaUpload(db, first);
    // 実測失敗で寸法が null のまま verified になったセッション
    const next = await verifiedSession(db, { targetMediaId: media.id }, null);

    const error = await createMediaVersionFromUpload(db, {
      mediaId: media.id,
      lineAccountId: 'account-a',
      uploadSessionId: next.id,
      expectedVersionNo: 1,
      changeReason: '差し替え',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(MediaVersionIncompatibleError);
    expect((error as MediaVersionIncompatibleError).blockers).toContain('metadata_missing');
  });

  it('種類が違うファイルは版追加できない', async () => {
    const first = await verifiedSession(db, {}, { width: 100, height: 50 });
    const media = await completeNewMediaUpload(db, first);
    const input = sessionInput({
      targetMediaId: media.id, filename: 'doc.pdf',
      kind: 'file', mimeType: 'application/pdf',
      metadata: { page_count: 3 },
    });
    await createMediaUploadSession(db, input);
    await verifyMediaUploadSession(db, input.id, 'account-a', 'etag-x', undefined);

    const error = await createMediaVersionFromUpload(db, {
      mediaId: media.id,
      lineAccountId: 'account-a',
      uploadSessionId: input.id,
      expectedVersionNo: 1,
      changeReason: '差し替え',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(MediaVersionIncompatibleError);
    expect((error as MediaVersionIncompatibleError).blockers).toContain('different_kind');
  });

  it('先に版が進んでいれば競合エラーで拒否し、版もメディアも変更しない', async () => {
    const first = await verifiedSession(db, {}, { width: 100, height: 50 });
    const media = await completeNewMediaUpload(db, first);
    const next = await verifiedSession(db, {
      targetMediaId: media.id, filename: 'b.png',
    }, { width: 100, height: 50 });

    const error = await createMediaVersionFromUpload(db, {
      mediaId: media.id,
      lineAccountId: 'account-a',
      uploadSessionId: next.id,
      expectedVersionNo: 99,
      changeReason: '遅れた書き込み',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(MediaVersionConflictError);
    expect((error as MediaVersionConflictError).currentVersionNo).toBe(1);
    expect((await getLatestMediaVersion(db, media.id, 'account-a'))?.version_no).toBe(1);
    expect((await getMediaById(db, media.id, 'account-a'))?.filename).toBe(media.filename);
    // セッションは completed にされず再確認できる
    const session = await getMediaUploadSession(db, next.id, 'account-a');
    expect(session?.status).toBe('verified');
  });

  it('別アカウントのメディアIDでは版を作れず、現行版番号も取れない', async () => {
    const first = await verifiedSession(db, {}, { width: 100, height: 50 });
    const media = await completeNewMediaUpload(db, first);

    await expect(getLatestMediaVersion(db, media.id, 'account-b')).resolves.toBeNull();
    const error = await createMediaVersionFromUpload(db, {
      mediaId: media.id,
      lineAccountId: 'account-b',
      uploadSessionId: first.id,
      expectedVersionNo: 1,
      changeReason: '越境',
    }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('media_not_found');
  });

  it('旧版へ内容情報を補うとき、記録済みの値は上書きしない', async () => {
    const media = await createMedia(db, {
      kind: 'image', lineAccountId: 'account-a', filename: 'old.png',
      mimeType: 'image/png', sizeBytes: 10, r2Key: 'media/account-a/old.png',
    });
    sqlite.prepare(
      `UPDATE media_versions SET width = 300, height = NULL WHERE media_id = ?`,
    ).run(media.id);
    const latest = await getLatestMediaVersion(db, media.id, 'account-a');

    await backfillMediaVersionMetadata(db, media, latest, { width: 640, height: 480 });

    // 記録済みの width=300 は守り、欠けていた height だけ補う
    const refilled = await getLatestMediaVersion(db, media.id, 'account-a');
    expect(refilled).toMatchObject({ width: 300, height: 480 });
    const updated = await getMediaById(db, media.id, 'account-a');
    expect(updated).toMatchObject({ width: 640, height: 480 });
  });

  it('予約の内容情報は取得でもそのまま読める', async () => {
    const created = await createMediaUploadSession(db, sessionInput({
      metadata: { width: 1, height: 2, duration_ms: 3, page_count: 4, codec: 'avc1.4d' },
    }));
    const fetched = await getMediaUploadSession(db, created.id, 'account-a');
    expect(fetched).toMatchObject({
      width: 1, height: 2, duration_ms: 3, page_count: 4, codec: 'avc1.4d',
    });
  });
});

describe('版追加の互換基準', () => {
  const base = {
    kind: 'image', width: 100, height: 50,
    duration_ms: null, page_count: null, codec: null,
  };

  it('画像は幅と高さの両方が一致したときだけ通る', () => {
    expect(evaluateMediaVersionCompat(base, { ...base })).toEqual([]);
    expect(evaluateMediaVersionCompat(base, { ...base, width: 200 }))
      .toEqual(['incompatible_dimensions']);
    expect(evaluateMediaVersionCompat(base, { ...base, height: 60 }))
      .toEqual(['incompatible_dimensions']);
  });

  it('片側でも寸法が欠ければ「判定材料不足」になる', () => {
    expect(evaluateMediaVersionCompat({ ...base, width: null }, { ...base }))
      .toEqual(['metadata_missing']);
    expect(evaluateMediaVersionCompat(base, { ...base, height: null }))
      .toEqual(['metadata_missing']);
  });

  it('動画・音声は長さが一致必須で、コーデックは両側あるときだけ比較する', () => {
    const video = {
      kind: 'video', width: null, height: null,
      duration_ms: 5000, page_count: null, codec: 'avc1',
    };
    expect(evaluateMediaVersionCompat(video, { ...video })).toEqual([]);
    expect(evaluateMediaVersionCompat(video, { ...video, duration_ms: 5001 }))
      .toEqual(['incompatible_duration']);
    expect(evaluateMediaVersionCompat(video, { ...video, codec: 'hvc1' }))
      .toEqual(['incompatible_codec']);
    // 片側にコーデックが無いときは不一致にしない
    expect(evaluateMediaVersionCompat(video, { ...video, codec: null })).toEqual([]);
  });

  it('ファイルはページ数が一致必須', () => {
    const pdf = {
      kind: 'file', width: null, height: null,
      duration_ms: null, page_count: 3, codec: null,
    };
    expect(evaluateMediaVersionCompat(pdf, { ...pdf })).toEqual([]);
    expect(evaluateMediaVersionCompat(pdf, { ...pdf, page_count: 4 }))
      .toEqual(['incompatible_pages']);
    expect(evaluateMediaVersionCompat({ ...pdf, page_count: null }, pdf))
      .toEqual(['metadata_missing']);
  });

  it('種類が違えば内容情報の一致に関係なく拒否する', () => {
    expect(evaluateMediaVersionCompat(
      base,
      { ...base, kind: 'file' },
    )).toContain('different_kind');
  });
});
