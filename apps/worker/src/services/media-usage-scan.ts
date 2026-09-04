import {
  getMediaUsageScanState,
  recordMediaUsage,
  recordMediaUsages,
  pruneStaleMediaUsages,
  pruneStaleMediaUsagesBatch,
  saveMediaUsageScanState,
  type MediaRefKind,
} from '@line-crm/db';

/**
 * メディアの使用箇所を数え直す。
 *
 * 画像を消す前に「5か所で使われています」と出すための表を作る。
 * 本文の中にURLが文字として埋まっているだけなので、走査するしかない。
 *
 * 走査した時点の情報でしかない。それでも「何も分からないまま消す」より
 * はるかにましだ、という判断で入れている。画面にもその旨を書いてある。
 */

/** どのテーブルの、どの列を見るか。 */
const SOURCES: Array<{ refKind: MediaRefKind; table: string; idColumn: string; columns: string[] }> = [
  { refKind: 'template', table: 'templates', idColumn: 'id', columns: ['message_content'] },
  {
    refKind: 'broadcast',
    table: 'broadcasts',
    idColumn: 'id',
    columns: ['message_content', 'message_bubbles_json'],
  },
  // 旧 rich_menus 表は存在しない。LINEへ送る実画像はページのR2キーで持つ。
  { refKind: 'rich_menu', table: 'rich_menu_pages', idColumn: 'id', columns: ['image_r2_key'] },
  {
    refKind: 'scenario_step',
    table: 'scenario_steps',
    idColumn: 'id',
    columns: ['message_content', 'message_bubbles_json'],
  },
  { refKind: 'nen_column', table: 'nen_columns', idColumn: 'id', columns: ['image_url'] },
  { refKind: 'event', table: 'events', idColumn: 'id', columns: ['image_url', 'og_image_url'] },
  { refKind: 'webinar', table: 'webinars', idColumn: 'id', columns: ['video_prefix'] },
];

export interface ScanResult {
  scanned: number;
  matched: number;
  pruned: number;
  source?: MediaRefKind;
  sourceRows?: number;
  cycleCompleted?: boolean;
}

type MediaToScan = { id: string; r2_key: string };

const MAX_SOURCE_ROWS = 4_000;
const MAX_USAGE_WRITES = 4_000;
const MAX_PRUNE_ROWS = 1_000;

function isMissingSourceTable(error: unknown, table: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('no such table') && message.includes(table);
}

async function findMatches(
  db: D1Database,
  item: MediaToScan,
): Promise<Array<{ refKind: MediaRefKind; refId: string }>> {
  const matches: Array<{ refKind: MediaRefKind; refId: string }> = [];
  for (const source of SOURCES) {
    const conditions = source.columns.map((col) => `${col} LIKE ?`).join(' OR ');
    const binds = source.columns.map(() => `%${item.r2_key}%`);
    const rows = await db
      .prepare(
        `SELECT ${source.idColumn} AS ref_id FROM ${source.table} WHERE ${conditions}`,
      )
      .bind(...binds)
      .all<{ ref_id: string }>();
    for (const row of rows.results) matches.push({ refKind: source.refKind, refId: row.ref_id });
  }
  return matches;
}

/**
 * 削除確認のため、1件だけを厳密に走査する。
 *
 * 定期走査と違い、1つでも読み口が失敗したら例外にする。途中まで読めた結果を
 * 「使用先0件」にして削除させないため、全問い合わせの成功後にだけ記録を更新する。
 */
export async function scanSingleMediaUsage(
  db: D1Database,
  now: string,
  item: MediaToScan,
): Promise<ScanResult> {
  const matches = await findMatches(db, item);
  for (const match of matches) {
    await recordMediaUsage(db, {
      mediaId: item.id,
      refKind: match.refKind,
      refId: match.refId,
    });
  }
  const pruned = await pruneStaleMediaUsages(db, now, [item.id]);
  return { scanned: 1, matched: matches.length, pruned };
}

/**
 * R2のキーで探す。
 *
 * URLではなくキー（media/xxxx.png）で探すのは、同じファイルが
 * 違うドメインのURLで書かれていることがあるため。キーは1つしかない。
 */
export async function scanMediaUsage(
  db: D1Database,
  now: string,
  opts: { limit?: number; sourceRowLimit?: number } = {},
): Promise<ScanResult> {
  const state = await getMediaUsageScanState(db, now);
  const media = await db
    .prepare(
      `SELECT id, r2_key FROM media
        WHERE created_at <= ?
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(state.cycleStartedAt, opts.limit ?? 500)
    .all<{ id: string; r2_key: string }>();
  if (media.results.length === 0) return { scanned: 0, matched: 0, pruned: 0 };

  const stateIsValid = state.sourceIndex >= 0 && state.sourceIndex <= SOURCES.length;
  const sourceIndex = stateIsValid ? state.sourceIndex : 0;
  const lastRefId = stateIsValid ? state.lastRefId : '';

  // 参照走査と古い記録の整理を同じcronへ載せると、整理件数分だけ上限を超える。
  // 7種類を読み終えた次のcronから、整理だけを上限付きで続ける。
  if (sourceIndex === SOURCES.length) {
    const pruned = await pruneStaleMediaUsagesBatch(
      db,
      state.cycleStartedAt,
      media.results.map((item) => item.id),
      MAX_PRUNE_ROWS,
    );
    const cycleCompleted = pruned < MAX_PRUNE_ROWS;
    await saveMediaUsageScanState(db, cycleCompleted ? {
      sourceIndex: 0,
      lastRefId: '',
      cycleStartedAt: now,
    } : {
      ...state,
      sourceIndex: SOURCES.length,
      lastRefId: '',
    }, now);
    return {
      scanned: media.results.length,
      matched: 0,
      pruned,
      sourceRows: 0,
      cycleCompleted,
    };
  }

  const source = SOURCES[sourceIndex];
  // 参照行と使用先の既存行確認を各4,000件までにし、media 500件・state 1件を
  // 足しても1回のcronで読むDB行を1万件未満に固定する。
  const rowLimit = Math.min(Math.max(opts.sourceRowLimit ?? 1_000, 1), MAX_SOURCE_ROWS);
  const selectedColumns = source.columns.map((column) => `, ${column}`).join('');
  let rows: Array<Record<string, unknown> & { ref_id: string }> = [];
  let sourceMissing = false;
  try {
    const result = await db.prepare(
      `SELECT ${source.idColumn} AS ref_id${selectedColumns}
         FROM ${source.table}
        WHERE ${source.idColumn} > ?
        ORDER BY ${source.idColumn} ASC
        LIMIT ?`,
    ).bind(lastRefId, rowLimit).all<Record<string, unknown> & { ref_id: string }>();
    rows = result.results;
  } catch (err) {
    // 古い検証環境などで機能の表がまだ無ければ、その読み口だけ次へ送る。
    // 一時的なD1障害まで「走査済み」にすると、1周後の整理で使用先を消してしまう。
    if (!isMissingSourceTable(err, source.table)) throw err;
    console.error(`media usage scan skipped ${source.table}:`, err);
    sourceMissing = true;
  }

  const usages: Array<{ mediaId: string; refKind: MediaRefKind; refId: string }> = [];
  let processedRows = 0;
  let writeBudgetExhausted = false;
  for (const row of rows) {
    const searchable = source.columns
      .map((column) => row[column])
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
    const rowUsages: typeof usages = [];
    for (const item of media.results) {
      if (item.r2_key && searchable.includes(item.r2_key)) {
        rowUsages.push({ mediaId: item.id, refKind: source.refKind, refId: String(row.ref_id) });
      }
    }
    if (usages.length + rowUsages.length > MAX_USAGE_WRITES) {
      writeBudgetExhausted = true;
      break;
    }
    usages.push(...rowUsages);
    processedRows += 1;
  }
  await recordMediaUsages(db, usages, now);

  const sourceCompleted = sourceMissing || (!writeBudgetExhausted && rows.length < rowLimit);
  let cycleCompleted = false;
  let pruned = 0;
  if (sourceCompleted && sourceIndex === SOURCES.length - 1) {
    // 整理は読込予算を分けるため、次のcronへ送る。
    await saveMediaUsageScanState(db, {
      sourceIndex: SOURCES.length,
      lastRefId: '',
      cycleStartedAt: state.cycleStartedAt,
    }, now);
  } else if (sourceCompleted) {
    await saveMediaUsageScanState(db, {
      ...state,
      sourceIndex: sourceIndex + 1,
      lastRefId: '',
    }, now);
  } else {
    await saveMediaUsageScanState(db, {
      ...state,
      sourceIndex,
      lastRefId: String(rows[processedRows - 1]?.ref_id ?? lastRefId),
    }, now);
  }

  return {
    scanned: media.results.length,
    matched: usages.length,
    pruned,
    source: source.refKind,
    sourceRows: rows.length,
    cycleCompleted,
  };
}
