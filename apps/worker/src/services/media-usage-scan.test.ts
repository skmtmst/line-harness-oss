import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = {
  getMediaUsageScanState: vi.fn(),
  recordMediaUsage: vi.fn(),
  recordMediaUsages: vi.fn(),
  pruneStaleMediaUsages: vi.fn(),
  pruneStaleMediaUsagesBatch: vi.fn(),
  saveMediaUsageScanState: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { scanMediaUsage, scanSingleMediaUsage } = await import('./media-usage-scan.js');

type SourceRow = { ref_id: string } & Record<string, unknown>;

function makeDb(
  media: Array<{ id: string; r2_key: string }>,
  sourceRows: Record<string, SourceRow[]> = {},
  broken: string[] = [],
  failure?: Error,
) {
  const queries: string[] = [];
  const db = {
    prepare(sql: string) {
      queries.push(sql);
      return {
        bind(...binds: unknown[]) {
          return {
            async all() {
              if (/FROM media\s/.test(sql)) return { results: media };
              const table = Object.keys(sourceRows).find((name) => sql.includes(`FROM ${name}`));
              const brokenTable = broken.find((name) => sql.includes(`FROM ${name}`));
              if (failure && sql.includes('FROM templates')) throw failure;
              if (brokenTable) throw new Error(`no such table: ${brokenTable}`);
              if (!table) return { results: [] };
              if (sql.includes('ORDER BY') && sql.includes('LIMIT ?')) {
                const after = String(binds[0] ?? '');
                const limit = Number(binds[1]);
                return {
                  results: sourceRows[table]
                    .filter((row) => row.ref_id > after)
                    .slice(0, limit),
                };
              }
              const key = String(binds[0] ?? '').replaceAll('%', '');
              return {
                results: sourceRows[table]
                  .filter((row) => Object.values(row).some(
                    (value) => typeof value === 'string' && value.includes(key),
                  ))
                  .map((row) => ({ ref_id: row.ref_id })),
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, queries };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getMediaUsageScanState.mockResolvedValue({
    sourceIndex: 0,
    lastRefId: '',
    cycleStartedAt: '2026-08-16T00:00:00.000',
  });
  dbMocks.pruneStaleMediaUsages.mockResolvedValue(0);
  dbMocks.pruneStaleMediaUsagesBatch.mockResolvedValue(0);
});

describe('定期走査', () => {
  it('1回に1種類だけ読み、見つけた使用先をまとめて記録する', async () => {
    const { db, queries } = makeDb(
      [{ id: 'md-1', r2_key: 'media/a.png' }],
      { templates: [
        { ref_id: 'tpl-1', message_content: 'media/a.png' },
        { ref_id: 'tpl-2', message_content: 'https://example/media/a.png' },
      ] },
    );

    const result = await scanMediaUsage(db, '2026-08-16T06:00:00.000');

    expect(result).toMatchObject({
      scanned: 1,
      matched: 2,
      source: 'template',
      sourceRows: 2,
      cycleCompleted: false,
    });
    expect(dbMocks.recordMediaUsages).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordMediaUsages).toHaveBeenCalledWith(db, [
      { mediaId: 'md-1', refKind: 'template', refId: 'tpl-1' },
      { mediaId: 'md-1', refKind: 'template', refId: 'tpl-2' },
    ], '2026-08-16T06:00:00.000');
    expect(queries.filter((sql) => sql.includes('FROM templates'))).toHaveLength(1);
    expect(queries.some((sql) => sql.includes('FROM broadcasts'))).toBe(false);
    expect(dbMocks.saveMediaUsageScanState).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ sourceIndex: 1, lastRefId: '' }),
      '2026-08-16T06:00:00.000',
    );
  });

  it('500メディアと多数の参照でも合計1万行未満で止め、次回用カーソルを保存する', async () => {
    const media = Array.from({ length: 500 }, (_, index) => ({
      id: `md-${String(index).padStart(3, '0')}`,
      r2_key: `media/${String(index).padStart(3, '0')}.png`,
    }));
    const templates = Array.from({ length: 9_500 }, (_, index) => ({
      ref_id: `tpl-${String(index).padStart(4, '0')}`,
      message_content: `https://example.test/${media[index % media.length].r2_key}`,
    }));
    const { db, queries } = makeDb(media, { templates });

    const result = await scanMediaUsage(db, '2026-08-16T06:00:00.000', {
      sourceRowLimit: 50_000,
    });

    // state 1行 + media 500行 + source 4,000行 + upsert確認最大4,000行 = 8,501行。
    expect(result).toMatchObject({ scanned: 500, matched: 4_000, sourceRows: 4_000 });
    expect(queries).toHaveLength(2);
    expect(dbMocks.recordMediaUsages).toHaveBeenCalledTimes(1);
    expect(dbMocks.saveMediaUsageScanState).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ sourceIndex: 0, lastRefId: 'tpl-3999' }),
      '2026-08-16T06:00:00.000',
    );
    expect(dbMocks.pruneStaleMediaUsages).not.toHaveBeenCalled();
  });

  it('7種類目を終えたら整理専用の次回へ進む', async () => {
    dbMocks.getMediaUsageScanState.mockResolvedValue({
      sourceIndex: 6,
      lastRefId: '',
      cycleStartedAt: '2026-08-15T00:00:00.000',
    });
    const { db } = makeDb(
      [{ id: 'md-1', r2_key: 'media/a.png' }],
      { webinars: [{ ref_id: 'webinar-1', video_prefix: 'media/a.png' }] },
    );

    const result = await scanMediaUsage(db, '2026-08-16T06:00:00.000');

    expect(result).toMatchObject({ matched: 1, pruned: 0, cycleCompleted: false });
    expect(dbMocks.pruneStaleMediaUsagesBatch).not.toHaveBeenCalled();
    expect(dbMocks.saveMediaUsageScanState).toHaveBeenCalledWith(db, {
      sourceIndex: 7,
      lastRefId: '',
      cycleStartedAt: '2026-08-15T00:00:00.000',
    }, '2026-08-16T06:00:00.000');
  });

  it('整理を1,000件ずつ続け、残りが無い回だけ1周を完了する', async () => {
    dbMocks.getMediaUsageScanState.mockResolvedValue({
      sourceIndex: 7,
      lastRefId: '',
      cycleStartedAt: '2026-08-15T00:00:00.000',
    });
    const { db } = makeDb([{ id: 'md-1', r2_key: 'media/a.png' }]);
    dbMocks.pruneStaleMediaUsagesBatch
      .mockResolvedValueOnce(1_000)
      .mockResolvedValueOnce(12);

    await expect(scanMediaUsage(db, '2026-08-16T06:00:00.000')).resolves.toMatchObject({
      pruned: 1_000,
      cycleCompleted: false,
    });
    await expect(scanMediaUsage(db, '2026-08-16T12:00:00.000')).resolves.toMatchObject({
      pruned: 12,
      cycleCompleted: true,
    });
    expect(dbMocks.pruneStaleMediaUsagesBatch).toHaveBeenNthCalledWith(
      1,
      db,
      '2026-08-15T00:00:00.000',
      ['md-1'],
      1_000,
    );
    expect(dbMocks.saveMediaUsageScanState).toHaveBeenLastCalledWith(db, {
      sourceIndex: 0,
      lastRefId: '',
      cycleStartedAt: '2026-08-16T12:00:00.000',
    }, '2026-08-16T12:00:00.000');
  });

  it('1行に多数のメディアがあっても更新予算を越えた行の手前で止める', async () => {
    const media = Array.from({ length: 500 }, (_, index) => ({
      id: `md-${index}`,
      r2_key: `media/${index}.png`,
    }));
    const message = media.map((item) => item.r2_key).join(' ');
    const templates = Array.from({ length: 10 }, (_, index) => ({
      ref_id: `tpl-${index}`,
      message_content: message,
    }));
    const { db } = makeDb(media, { templates });

    const result = await scanMediaUsage(db, '2026-08-16T06:00:00.000', {
      sourceRowLimit: 50_000,
    });

    expect(result).toMatchObject({ matched: 4_000, sourceRows: 10, cycleCompleted: false });
    expect(dbMocks.saveMediaUsageScanState).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ sourceIndex: 0, lastRefId: 'tpl-7' }),
      '2026-08-16T06:00:00.000',
    );
  });

  it('表が無い読み口だけ飛ばし、次の種類へ進む', async () => {
    const { db } = makeDb(
      [{ id: 'md-1', r2_key: 'media/a.png' }],
      {},
      ['templates'],
    );

    const result = await scanMediaUsage(db, '2026-08-16T06:00:00.000');

    expect(result).toMatchObject({ matched: 0, source: 'template', sourceRows: 0 });
    expect(dbMocks.saveMediaUsageScanState).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ sourceIndex: 1 }),
      '2026-08-16T06:00:00.000',
    );
  });

  it('一時的なD1エラーではカーソルを進めず、古い記録も整理しない', async () => {
    const { db } = makeDb(
      [{ id: 'md-1', r2_key: 'media/a.png' }],
      {},
      [],
      new Error('D1_ERROR: network timeout'),
    );

    await expect(scanMediaUsage(db, '2026-08-16T06:00:00.000'))
      .rejects.toThrow('network timeout');
    expect(dbMocks.recordMediaUsages).not.toHaveBeenCalled();
    expect(dbMocks.saveMediaUsageScanState).not.toHaveBeenCalled();
    expect(dbMocks.pruneStaleMediaUsages).not.toHaveBeenCalled();
  });

  it('使用先の一括記録に失敗したときはカーソルを進めない', async () => {
    const { db } = makeDb(
      [{ id: 'md-1', r2_key: 'media/a.png' }],
      { templates: [{ ref_id: 'tpl-1', message_content: 'media/a.png' }] },
    );
    dbMocks.recordMediaUsages.mockRejectedValueOnce(new Error('batch write failed'));

    await expect(scanMediaUsage(db, '2026-08-16T06:00:00.000'))
      .rejects.toThrow('batch write failed');
    expect(dbMocks.saveMediaUsageScanState).not.toHaveBeenCalled();
    expect(dbMocks.pruneStaleMediaUsages).not.toHaveBeenCalled();
  });

  it('メディアが1件も無ければDB走査を始めない', async () => {
    const { db, queries } = makeDb([]);
    const result = await scanMediaUsage(db, '2026-08-16T06:00:00.000');
    expect(result).toEqual({ scanned: 0, matched: 0, pruned: 0 });
    expect(queries).toHaveLength(1);
    expect(dbMocks.getMediaUsageScanState).toHaveBeenCalledTimes(1);
    expect(dbMocks.pruneStaleMediaUsages).not.toHaveBeenCalled();
  });
});

describe('削除直前の厳密な走査', () => {
  it('7種類を全部読めた後だけ記録と整理を行う', async () => {
    const item = { id: 'md-1', r2_key: 'media/a.png' };
    const { db } = makeDb([item], {
      templates: [{ ref_id: 'tpl-1', message_content: 'media/a.png' }],
    });

    const result = await scanSingleMediaUsage(db, '2026-08-16T00:00:00.000', item);

    expect(result).toEqual({ scanned: 1, matched: 1, pruned: 0 });
    expect(dbMocks.recordMediaUsage).toHaveBeenCalledWith(
      db,
      { mediaId: 'md-1', refKind: 'template', refId: 'tpl-1' },
    );
    expect(dbMocks.pruneStaleMediaUsages).toHaveBeenCalledWith(
      db,
      '2026-08-16T00:00:00.000',
      ['md-1'],
    );
  });

  it('1種類でも読めなければ0件にせず、記録も整理もしない', async () => {
    const item = { id: 'md-1', r2_key: 'media/a.png' };
    const { db } = makeDb([item], {
      templates: [{ ref_id: 'tpl-1', message_content: 'media/a.png' }],
    }, ['webinars']);

    await expect(
      scanSingleMediaUsage(db, '2026-08-16T00:00:00.000', item),
    ).rejects.toThrow('no such table: webinars');
    expect(dbMocks.recordMediaUsage).not.toHaveBeenCalled();
    expect(dbMocks.pruneStaleMediaUsages).not.toHaveBeenCalled();
  });
});
