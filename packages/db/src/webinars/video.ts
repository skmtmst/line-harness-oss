import { jstNow } from '../utils.js';
import { type WebinarVideoStage, type WebinarVideoAsset, type WebinarSessionRow } from './types.js';


/** 動画の準備の段（N）。検査 → 変換 → 配信の形 → 表紙。 */
export const WEBINAR_VIDEO_STAGES: readonly WebinarVideoStage[] = [
  'uploaded', 'inspecting', 'converting', 'packaging', 'thumbnail', 'ready',
];

/** 動画は終了から90日で消す。ただし使っている間は消さない（N）。 */
export const WEBINAR_VIDEO_RETENTION_DAYS = 90;

export async function getWebinarVideoAsset(
  db: D1Database,
  webinarId: string,
): Promise<WebinarVideoAsset | null> {
  return db.prepare(
    `SELECT * FROM webinar_video_assets WHERE webinar_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(webinarId).first<WebinarVideoAsset>();
}

/**
 * 動画の段を進める。前の段に戻さない（failed はどの段からでも行ける）。
 * 進められない段には null を返す。
 */
export async function advanceWebinarVideoAsset(
  db: D1Database,
  webinarId: string,
  stage: WebinarVideoStage,
  options?: { errorCode?: string | null; durationSeconds?: number | null; checksum?: string | null },
): Promise<WebinarVideoAsset | null> {
  const now = jstNow();
  const current = await getWebinarVideoAsset(db, webinarId);
  if (!current) {
    if (stage !== 'uploaded') return null;
    await db.prepare(
      `INSERT INTO webinar_video_assets
         (id, webinar_id, stage, provider, duration_seconds, checksum, error_code, created_at, updated_at)
       VALUES (?, ?, 'uploaded', 'r2_hls', ?, ?, NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(), webinarId, options?.durationSeconds ?? 0,
      options?.checksum ?? null, now, now,
    ).run();
    return getWebinarVideoAsset(db, webinarId);
  }
  const order = (s: string): number => {
    if (s === 'failed') return -1;
    return WEBINAR_VIDEO_STAGES.indexOf(s as WebinarVideoStage);
  };
  const next = order(stage);
  // failed はどこからでも行ける。ready の後は変えない（作り直しは新規の資産）。
  if (stage === 'failed' ? current.stage === 'failed' : (next !== order(current.stage) + 1)) {
    return null;
  }
  await db.prepare(
    `UPDATE webinar_video_assets
        SET stage = ?, error_code = COALESCE(?, error_code),
            duration_seconds = COALESCE(?, duration_seconds),
            checksum = COALESCE(?, checksum), updated_at = ?
      WHERE id = ?`,
  ).bind(
    stage, options?.errorCode ?? null, options?.durationSeconds ?? null,
    options?.checksum ?? null, now, current.id,
  ).run();
  return getWebinarVideoAsset(db, webinarId);
}

/** 準備が済んだ（ready）動画だけ配信に選べる（N）。 */
export async function isWebinarVideoReady(
  db: D1Database,
  webinarId: string,
): Promise<boolean> {
  const asset = await getWebinarVideoAsset(db, webinarId);
  return asset?.stage === 'ready' && asset.purged_at === null;
}

export async function getWebinarSession(
  db: D1Database,
  webinarId: string,
  sessionStartAt: number,
): Promise<WebinarSessionRow | null> {
  return db.prepare(
    `SELECT * FROM webinar_sessions WHERE webinar_id = ? AND session_start_at = ?`,
  ).bind(webinarId, sessionStartAt).first<WebinarSessionRow>();
}

/** 開催回の定員を決める。行が無ければ作る。定員の取り消しは null。 */
export async function setWebinarSessionCapacity(
  db: D1Database,
  webinarId: string,
  sessionStartAt: number,
  capacity: number | null,
): Promise<WebinarSessionRow> {
  const now = jstNow();
  const existing = await getWebinarSession(db, webinarId, sessionStartAt);
  if (!existing) {
    await db.prepare(
      `INSERT INTO webinar_sessions
         (id, webinar_id, session_start_at, capacity, reserved_count, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 'open', ?, ?)`,
    ).bind(crypto.randomUUID(), webinarId, sessionStartAt, capacity, now, now).run();
  } else {
    await db.prepare(
      `UPDATE webinar_sessions
          SET capacity = ?,
              state = CASE WHEN ? IS NOT NULL AND reserved_count >= ? THEN 'full' ELSE 'open' END,
              updated_at = ?
        WHERE id = ?`,
    ).bind(capacity, capacity, capacity, now, existing.id).run();
  }
  return (await getWebinarSession(db, webinarId, sessionStartAt))!;
}

/**
 * 開催回の席を1つ確保する（N）。定員は申込の時に条件付き更新で確保する。
 * 行が無い開催回は従来どおり無制限（'unlimited'）。
 * 二重実行でも定員を超えない（UPDATE の条件で守る）。
 */
export async function reserveWebinarSeat(
  db: D1Database,
  webinarId: string,
  sessionStartAt: number,
): Promise<'reserved' | 'full' | 'unlimited'> {
  const session = await getWebinarSession(db, webinarId, sessionStartAt);
  if (!session || session.capacity === null || session.state === 'closed') {
    if (session?.state === 'closed') return 'full';
    return 'unlimited';
  }
  const now = jstNow();
  const result = await db.prepare(
    `UPDATE webinar_sessions
        SET reserved_count = reserved_count + 1,
            state = CASE WHEN reserved_count + 1 >= capacity THEN 'full' ELSE 'open' END,
            updated_at = ?
      WHERE webinar_id = ? AND session_start_at = ?
        AND (capacity IS NULL OR reserved_count < capacity)`,
  ).bind(now, webinarId, sessionStartAt).run();
  return (result.meta.changes ?? 0) > 0 ? 'reserved' : 'full';
}

/** 席の確保を取り消す（再予約・取消で空ける）。0を割らない。 */
export async function releaseWebinarSeat(
  db: D1Database,
  webinarId: string,
  sessionStartAt: number,
): Promise<void> {
  await db.prepare(
    `UPDATE webinar_sessions
        SET reserved_count = CASE WHEN reserved_count > 0 THEN reserved_count - 1 ELSE 0 END,
            state = CASE WHEN state = 'closed' THEN 'closed' ELSE 'open' END,
            updated_at = ?
      WHERE webinar_id = ? AND session_start_at = ?`,
  ).bind(jstNow(), webinarId, sessionStartAt).run();
}

/**
 * 見逃し配信の期限内か（N）。「する」を選んだ開催回だけ、開催から
 * 設定日数（既定7日）以内の視聴に使う。期限切れは送らない。
 */
export async function isWebinarMissedInWindow(
  db: D1Database,
  webinarId: string,
  sessionStartAt: number,
  nowEpochSeconds: number,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT missed_enabled, missed_window_days
       FROM webinar_notification_settings WHERE webinar_id = ?`,
  ).bind(webinarId).first<{ missed_enabled: number; missed_window_days: number | null }>();
  if (!row || row.missed_enabled !== 1) return false;
  const windowDays = row.missed_window_days ?? 7;
  return nowEpochSeconds <= sessionStartAt + windowDays * 86400;
}

/**
 * 保管期限を過ぎた動画の資産（N）。終了から90日で消す対象。
 * 消す操作自体は purgeWebinarVideoAsset で「使っている間は消さない」を守る。
 */
export async function findExpiredWebinarVideoAssets(
  db: D1Database,
  nowIso: string,
): Promise<WebinarVideoAsset[]> {
  const { results } = await db.prepare(
    `SELECT * FROM webinar_video_assets
      WHERE expires_at IS NOT NULL AND expires_at <= ?
        AND purged_at IS NULL
      ORDER BY expires_at ASC`,
  ).bind(nowIso).all<WebinarVideoAsset>();
  return results ?? [];
}

/** 使っている間（公開中のウェビナーが参照）は消さない。 */
export async function canPurgeWebinarVideoAsset(
  db: D1Database,
  assetId: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT a.id FROM webinar_video_assets a
       JOIN webinars w ON w.video_asset_id = a.id
      WHERE a.id = ? AND w.status = 'active'`,
  ).bind(assetId).first<{ id: string }>();
  return row === null;
}

/** 保管期限切れの動画を消す。使っている間は消さず false を返す。 */
export async function purgeWebinarVideoAsset(
  db: D1Database,
  assetId: string,
  nowIso?: string,
): Promise<boolean> {
  if (!await canPurgeWebinarVideoAsset(db, assetId)) return false;
  const result = await db.prepare(
    `UPDATE webinar_video_assets SET purged_at = ?, updated_at = ? WHERE id = ? AND purged_at IS NULL`,
  ).bind(nowIso ?? jstNow(), nowIso ?? jstNow(), assetId).run();
  return (result.meta.changes ?? 0) > 0;
}
