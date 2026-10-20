import { getMediaVersionKeys } from './storage-keys.js';
import { mediaLiveContentPath, type Media, USAGE_REPLACE_PAIR_CHUNK } from './primitives.js';
import { LOOKUP_CHUNK, isMissingTableError } from './definitions.js';
import { type UsageContentRow, type NamedReference, type MediaUsageReferenceState, type MediaUsage, type MediaUsageReferenceErrorCode } from './types.js';
import { belongsToAccount, accountIdsOf } from './impact.js';


/**
 * 使用先本文を照合するトークン。
 *
 * 固定参照は版ごとのr2_key（旧版を指すものも使用中）、ライブ参照は
 * メディアIDの公開パスで見つける。
 */
export async function getMediaUsageMatchTokens(
  db: D1Database,
  mediaId: string,
): Promise<string[]> {
  return [...new Set([...await getMediaVersionKeys(db, mediaId), mediaLiveContentPath(mediaId)])];
}

/** 複数メディア分を1回で取る。media_id → 照合トークン。 */
export async function getMediaUsageMatchTokenMap(
  db: D1Database,
  mediaIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const id of mediaIds) map.set(id, [mediaLiveContentPath(id)]);
  for (let index = 0; index < mediaIds.length; index += LOOKUP_CHUNK) {
    const chunk = mediaIds.slice(index, index + LOOKUP_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db
      .prepare(`SELECT media_id, r2_key FROM media_versions WHERE media_id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ media_id: string; r2_key: string }>();
    for (const row of rows.results) {
      const tokens = map.get(row.media_id) ?? [mediaLiveContentPath(row.media_id)];
      if (!tokens.includes(row.r2_key)) tokens.push(row.r2_key);
      map.set(row.media_id, tokens);
    }
  }
  return map;
}

/** 公開のライブ配信がメディアIDから最新版へ解決するための最小限の行。 */
export async function getMediaLiveTarget(
  db: D1Database,
  id: string,
): Promise<Pick<Media, 'id' | 'r2_key' | 'mime_type' | 'filename'> | null> {
  return db.prepare(
    `SELECT id, r2_key, mime_type, filename FROM media WHERE id = ?`,
  ).bind(id).first<Pick<Media, 'id' | 'r2_key' | 'mime_type' | 'filename'>>();
}

export function usageTextColumns(row: Record<string, unknown>, columns: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const column of columns) {
    const value = row[column];
    if (typeof value === 'string' && value) result[column] = value;
  }
  return result;
}

/**
 * 使用先の正本行を読み、参照が埋まっている列だけを返す。
 *
 * 表示側（describeMediaUsage）と同じ所属判定で、見せられる使用先だけを
 * 扱う。共有されている配信・イベントは内容の書き換えを止める目印として
 * `shared` を立てる。
 */
export async function loadUsageContent(
  db: D1Database,
  usage: { ref_kind: string; ref_id: string },
  lineAccountId: string,
): Promise<UsageContentRow | null> {
  switch (usage.ref_kind) {
    case 'template': {
      const row = await db.prepare(
        `SELECT message_content FROM templates WHERE id = ? AND line_account_id = ?
         UNION ALL SELECT payload_json AS message_content FROM broadcast_message_assets
           WHERE id = ? AND line_account_id = ?`,
      ).bind(usage.ref_id, lineAccountId, usage.ref_id, lineAccountId).first<Record<string, unknown>>();
      return row ? { shared: false, columns: usageTextColumns(row, ['message_content']) } : null;
    }
    case 'broadcast': {
      const row = await db.prepare(
        `SELECT message_content, message_bubbles_json,
                line_account_id AS account_id, account_ids
           FROM broadcasts WHERE id = ?`,
      ).bind(usage.ref_id).first<Record<string, unknown> & NamedReference>();
      if (!row || !belongsToAccount(row, lineAccountId)) return null;
      return {
        shared: row.account_id !== lineAccountId
          || accountIdsOf(row).some((id) => id !== lineAccountId),
        columns: usageTextColumns(row, ['message_content', 'message_bubbles_json']),
      };
    }
    case 'rich_menu': {
      const row = await db.prepare(
        `SELECT p.image_r2_key FROM rich_menu_pages p
           JOIN rich_menu_groups g ON g.id = p.group_id
          WHERE p.id = ? AND g.account_id = ?`,
      ).bind(usage.ref_id, lineAccountId).first<Record<string, unknown>>();
      return row ? { shared: false, columns: usageTextColumns(row, ['image_r2_key']) } : null;
    }
    case 'scenario_step': {
      const row = await db.prepare(
        `SELECT ss.message_content, ss.message_bubbles_json
           FROM scenario_steps ss
           JOIN scenarios s ON s.id = ss.scenario_id
          WHERE ss.id = ? AND s.line_account_id = ?`,
      ).bind(usage.ref_id, lineAccountId).first<Record<string, unknown>>();
      return row
        ? { shared: false, columns: usageTextColumns(row, ['message_content', 'message_bubbles_json']) }
        : null;
    }
    case 'nen_column': {
      const row = await db.prepare(
        `SELECT image_url FROM nen_columns WHERE id = ? AND line_account_id = ?`,
      ).bind(usage.ref_id, lineAccountId).first<Record<string, unknown>>();
      return row ? { shared: false, columns: usageTextColumns(row, ['image_url']) } : null;
    }
    case 'event': {
      const row = await db.prepare(
        `SELECT image_url, og_image_url, line_account_id AS account_id, account_ids
           FROM events WHERE id = ?`,
      ).bind(usage.ref_id).first<Record<string, unknown> & NamedReference>();
      if (!row || !belongsToAccount(row, lineAccountId)) return null;
      return {
        shared: row.account_id !== lineAccountId
          || accountIdsOf(row).some((id) => id !== lineAccountId),
        columns: usageTextColumns(row, ['image_url', 'og_image_url']),
      };
    }
    case 'webinar': {
      const row = await db.prepare(
        `SELECT video_prefix FROM webinars WHERE id = ? AND account_id = ?`,
      ).bind(usage.ref_id, lineAccountId).first<Record<string, unknown>>();
      return row ? { shared: false, columns: usageTextColumns(row, ['video_prefix']) } : null;
    }
    case 'booking_menu':
    case 'booking_staff':
    case 'booking_settings': {
      const table = usage.ref_kind === 'booking_menu' ? 'menus' : usage.ref_kind === 'booking_staff' ? 'staff' : 'booking_settings';
      const columns = usage.ref_kind === 'booking_settings'
        ? ['store_photo_media_id', 'store_photo_interior_media_id', 'store_photo_waiting_media_id'] : ['photo_media_id'];
      const row = await db.prepare(`SELECT ${columns.join(',')} FROM ${table} WHERE id=? AND line_account_id=?${table === 'booking_settings' ? '' : ' AND deleted_at IS NULL'}`)
        .bind(usage.ref_id, lineAccountId).first<Record<string, unknown>>();
      if (!row) return null;
      return { shared: false, columns: Object.fromEntries(columns.flatMap(column =>
        typeof row[column] === 'string' && row[column] ? [[column, mediaLiveContentPath(row[column])]] : [])) };
    }
    default:
      return null;
  }
}

export function detectUsageReferenceState(
  mediaId: string,
  versions: Array<{ version_no: number; r2_key: string }>,
  columns: Record<string, string>,
): MediaUsageReferenceState {
  const text = Object.values(columns).join('\n');
  const live = text.includes(mediaLiveContentPath(mediaId));
  const hits = versions.filter((version) => version.r2_key && text.includes(version.r2_key));
  if (live) return hits.length > 0
    ? { mode: 'mixed', versionNo: null }
    : { mode: 'live', versionNo: null };
  if (hits.length === 1) return { mode: 'pinned', versionNo: Number(hits[0].version_no) };
  if (hits.length > 1) return { mode: 'mixed', versionNo: null };
  // 記録はあるが本文からは今の形を判別できない。触らずそのまま知らせる。
  return { mode: 'unknown', versionNo: null };
}

/**
 * 記録済み使用先ごとの参照モードと固定版を読む。
 *
 * 返す配列は `usages` と同じ順番。正本が別アカウントへ移った等で読めない
 * 使用先は `unavailable` として残す。
 */
export async function getMediaUsageReferenceStates(
  db: D1Database,
  input: {
    media: Media;
    usages: MediaUsage[];
    versions: Array<{ version_no: number; r2_key: string }>;
    lineAccountId: string;
  },
): Promise<MediaUsageReferenceState[]> {
  return Promise.all(input.usages.map(async (usage) => {
    try {
      const row = await loadUsageContent(db, usage, input.lineAccountId);
      if (!row) return { mode: 'unavailable' as const, versionNo: null };
      return detectUsageReferenceState(input.media.id, input.versions, row.columns);
    } catch (err) {
      // 表そのものが無い読み口は「未確認」に倒し、全体を503にしない（R34）。
      if (!isMissingTableError(err)) throw err;
      return { mode: 'unavailable' as const, versionNo: null };
    }
  }));
}

export class MediaUsageReferenceError extends Error {
  constructor(readonly code: MediaUsageReferenceErrorCode) {
    super(code);
    this.name = 'MediaUsageReferenceError';
  }
}

/**
 * 1つの使用先の参照を、ライブ参照または指定した固定版へ書き換える。
 *
 * 本文に埋まっている現在の参照文字列（全版のr2_key・ライブ参照パス）を
 * 見つけ、その使用先の行だけを対象に置き換える。同じメディアを使う
 * 他の使用先の行には一切触れない。
 *
 * ライブ参照はURLとして読まれる列（テンプレート・一斉配信・シナリオ・
 * NEN・イベント）でのみ使える。リッチメニューはR2キーで渡す列のため
 * 固定版だけ、ウェビナー動画は一式を持つため対象外とする。
 */
export async function retargetMediaUsageReference(
  db: D1Database,
  input: {
    media: Media;
    lineAccountId: string;
    refKind: string;
    refId: string;
    target: { mode: 'live' } | { mode: 'pinned'; versionNo: number };
    /** 同じPATCHで保存するメディア名・フォルダ。参照切替と同じbatchへ載せる。 */
    mediaUpdate?: { expectedRevision?: number; filename?: string; folderId?: string | null };
  },
): Promise<{ changed: boolean; state: MediaUsageReferenceState }> {
  if (input.refKind === 'webinar' || input.refKind === 'booking_menu' || input.refKind === 'booking_staff' || input.refKind === 'booking_settings') {
    throw new MediaUsageReferenceError('media_reference_unsupported');
  }
  if (input.target.mode === 'live' && input.refKind === 'rich_menu') {
    throw new MediaUsageReferenceError('media_reference_unsupported');
  }
  const versionRows = (await db.prepare(
    `SELECT version_no, r2_key, scan_status FROM media_versions WHERE media_id = ?`,
  ).bind(input.media.id).all<{ version_no: number; r2_key: string; scan_status: string }>()).results;
  const targetVersionNo = input.target.mode === 'pinned' ? input.target.versionNo : null;
  const targetKey = targetVersionNo === null
    ? undefined
    : versionRows.find(
        (version) => Number(version.version_no) === targetVersionNo
          && version.scan_status === 'verified',
      )?.r2_key;
  if (input.target.mode === 'pinned' && !targetKey) {
    throw new MediaUsageReferenceError('media_version_not_found');
  }

  const usage = { ref_kind: input.refKind, ref_id: input.refId };
  const row = await loadUsageContent(db, usage, input.lineAccountId);
  if (!row) throw new MediaUsageReferenceError('media_usage_not_found');
  if (row.shared) throw new MediaUsageReferenceError('media_usage_shared');

  const livePath = mediaLiveContentPath(input.media.id);
  const state = detectUsageReferenceState(input.media.id, versionRows, row.columns);
  const mediaSets: string[] = [];
  const mediaValues: unknown[] = [];
  if (input.mediaUpdate?.filename !== undefined) {
    mediaSets.push('filename = ?');
    mediaValues.push(input.mediaUpdate.filename);
  }
  if (input.mediaUpdate && 'folderId' in input.mediaUpdate) {
    mediaSets.push('folder_id = ?');
    mediaValues.push(input.mediaUpdate.folderId ?? null);
  }
  const mediaUpdateStatement = mediaSets.length > 0
    ? db.prepare(`UPDATE media SET ${mediaSets.join(', ')}, revision = revision + 1 WHERE id = ? AND line_account_id = ?${input.mediaUpdate?.expectedRevision === undefined ? '' : ' AND revision = ?'}`)
      .bind(...mediaValues, input.media.id, input.lineAccountId, ...(input.mediaUpdate?.expectedRevision === undefined ? [] : [input.mediaUpdate.expectedRevision]))
    : null;
  const already = input.target.mode === 'live'
    ? state.mode === 'live'
    : state.mode === 'pinned' && state.versionNo === input.target.versionNo;
  if (already) {
    if (mediaUpdateStatement) {
      const [result] = await db.batch([mediaUpdateStatement]);
      if (Number(result.meta?.changes ?? 0) !== 1) throw new MediaUsageReferenceError('media_metadata_conflict');
    }
    return { changed: false, state };
  }
  if (state.mode === 'unknown') {
    // このメディアを指す文字列が本文に無い＝記録だけが残っている。
    // 置き換える正本が分からないので、無闇に書き換えず読み直しを促す。
    throw new MediaUsageReferenceError('media_reference_stale');
  }

  const scope = (() => {
    switch (input.refKind) {
      case 'template':
      case 'nen_column':
        return { sql: 'line_account_id = ?', binds: [input.lineAccountId] };
      case 'broadcast':
      case 'event':
        return {
          sql: `line_account_id = ?
            AND (account_ids IS NULL OR json_array_length(account_ids) <= 1)`,
          binds: [input.lineAccountId],
        };
      case 'rich_menu':
        return {
          sql: `EXISTS (SELECT 1 FROM rich_menu_groups g
            WHERE g.id = rich_menu_pages.group_id AND g.account_id = ?)`,
          binds: [input.lineAccountId],
        };
      case 'scenario_step':
        return {
          sql: `EXISTS (SELECT 1 FROM scenarios s
            WHERE s.id = scenario_steps.scenario_id AND s.line_account_id = ?)`,
          binds: [input.lineAccountId],
        };
      default:
        throw new MediaUsageReferenceError('media_reference_unsupported');
    }
  })();
  const table: Record<string, string> = {
    template: 'templates',
    broadcast: 'broadcasts',
    rich_menu: 'rich_menu_pages',
    scenario_step: 'scenario_steps',
    nen_column: 'nen_columns',
    event: 'events',
  };
  const targetTable = table[input.refKind];
  if (!targetTable) throw new MediaUsageReferenceError('media_reference_unsupported');

  const statements: D1PreparedStatement[] = mediaUpdateStatement ? [mediaUpdateStatement] : [];
  for (const [column, value] of Object.entries(row.columns)) {
    const pairs: Array<[string, string]> = [];
    if (input.target.mode === 'live') {
      for (const version of versionRows) {
        if (!version.r2_key || !value.includes(version.r2_key)) continue;
        // URL形の埋め込みはURLごと、単体のキーはパスへ置き換える。
        pairs.push([`/images/${version.r2_key}`, livePath]);
        pairs.push([version.r2_key, livePath]);
      }
    } else {
      for (const version of versionRows) {
        if (!version.r2_key || !value.includes(version.r2_key)) continue;
        pairs.push([version.r2_key, targetKey!]);
      }
      if (value.includes(livePath)) pairs.push([livePath, `/images/${targetKey}`]);
    }
    if (pairs.length === 0) continue;
    // D1 は1文100 bindまで。置換2＋含有判定1ずつに対象ID・所属を足すため、
    // 24対ずつに分ける（最大74 bind）。
    for (let index = 0; index < pairs.length; index += USAGE_REPLACE_PAIR_CHUNK) {
      const chunk = pairs.slice(index, index + USAGE_REPLACE_PAIR_CHUNK);
      const expression = chunk.reduce((expr) => `REPLACE(${expr}, ?, ?)`, column);
      // 上と同じ理由で LIKE '%...%' を使わない（長いR2キーでD1が
      // 「pattern too complex」を返す）。
      const guard = chunk.map(() => `instr(${column}, ?) > 0`).join(' OR ');
      statements.push(db.prepare(
        `UPDATE ${targetTable} SET ${column} = ${expression}
          WHERE id = ? AND ${scope.sql} AND (${guard})${mediaUpdateStatement ? ' AND changes() = 1' : ''}`,
      ).bind(
        ...chunk.flatMap(([from, to]) => [from, to]),
        input.refId,
        ...scope.binds,
        ...chunk.map(([from]) => from),
      ));
    }
  }
  if (statements.length === (mediaUpdateStatement ? 1 : 0)) {
    throw new MediaUsageReferenceError('media_reference_stale');
  }
  const results = await db.batch(statements);
  if (mediaUpdateStatement && Number(results[0].meta?.changes ?? 0) !== 1) throw new MediaUsageReferenceError('media_metadata_conflict');
  const changed = results.some((result) => Number(result.meta?.changes ?? 0) > 0);

  // 書いた結果を読み直して確認する。途中で本文が変わっていた場合に
  // 「切り替わった」と誤って見せないため。
  const after = await loadUsageContent(db, usage, input.lineAccountId);
  const afterState = after
    ? detectUsageReferenceState(input.media.id, versionRows, after.columns)
    : null;
  const ok = afterState && (input.target.mode === 'live'
    ? afterState.mode === 'live'
    : afterState.mode === 'pinned' && afterState.versionNo === input.target.versionNo);
  if (!ok) throw new MediaUsageReferenceError('media_reference_stale');
  return { changed, state: afterState! };
}
