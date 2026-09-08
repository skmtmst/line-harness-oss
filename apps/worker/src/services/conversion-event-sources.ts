import { trackConversion } from '@line-crm/db';

/**
 * コンバージョン起点 → 実イベントの接続口。
 *
 * 画面で選べる6起点のうち、url_reach 以外の5つは自動計測されていなかった
 * (#648)。各業務イベントの発生点からこの関数を呼ぶと、一致する計測中の
 * 成果地点を探して trackConversion へ渡す。記録の重複排除・一人一回判定・
 * 同時到着の競合は trackConversion 側(冪等キー+一意索引)が受け持つ。
 *
 * 失敗しても呼び出し元の業務処理は巻き添えにしない。呼び出し側は
 * executionCtx.waitUntil(it) で best-effort 実行すること。
 */

/** 画面で選べる6起点。conversions.ts の DEFINITION_SOURCE_TYPES と一致させる。 */
export const CONVERSION_SOURCE_TYPES = [
  'ec_order_confirmed',
  'form_submitted',
  'reservation_confirmed',
  'url_reach',
  'webinar_completed',
  'tag_added',
] as const;

export type ConversionSourceType = (typeof CONVERSION_SOURCE_TYPES)[number];

function isConversionSourceType(value: string): value is ConversionSourceType {
  return (CONVERSION_SOURCE_TYPES as readonly string[]).includes(value);
}

export interface ConversionSourceEvent {
  /** 6起点のどれか。未知の値は成功扱いで記録だけ残す。 */
  sourceType: string;
  /** 計測するアカウント。省略時は友だち台帳から解決する。 */
  lineAccountId?: string | null;
  /** 成果を結びつける友だち。 */
  friendId: string;
  /** 元イベントの不変ID。再送・同時到着の重複排除に使う。 */
  sourceEventId: string;
  /** conversion_events.metadata に残す追加情報。 */
  metadata?: Record<string, unknown> | null;
}

export interface ConversionSourceResult {
  matched: number;
  recorded: number;
  failed: number;
  /** 何も数えなかった理由。数えたときは null。 */
  skipped: 'unknown_source' | 'invalid_input' | 'friend_not_found' | 'account_mismatch' | null;
}

interface ConversionPointRow {
  id: string;
}

function idempotencyKey(sourceType: string, sourceEventId: string): string {
  // 元IDが長い(署名付きURL等)場合に備えて切り詰める。同一イベントは
  // 同一キーになることが重要で、可逆性は要らない。
  const trimmed = sourceEventId.trim().slice(0, 120);
  return `cvsrc:${sourceType}:${trimmed}`;
}

/**
 * 業務イベントを成果計測へ接続する。未知の起点・境界不一致は例外にせず
 * 成功扱いで理由を返す(呼び出し元の業務処理を止めないため)。
 */
export async function recordConversionSourceEvent(
  db: D1Database,
  event: ConversionSourceEvent,
): Promise<ConversionSourceResult> {
  const empty: ConversionSourceResult = { matched: 0, recorded: 0, failed: 0, skipped: null };

  if (!isConversionSourceType(event.sourceType)) {
    // 未対応イベントは捨てず、運用者が後で辿れる形で残す(#648 完了条件)。
    console.log(JSON.stringify({
      event: 'conversion_source_unmatched',
      source_type: event.sourceType,
      friend_id: event.friendId,
      source_event_id: event.sourceEventId,
    }));
    return { ...empty, skipped: 'unknown_source' };
  }
  if (!event.friendId?.trim() || !event.sourceEventId?.trim()) {
    return { ...empty, skipped: 'invalid_input' };
  }

  // 友だちの所属でアカウント境界を確かめる。申告アカウントと違う友だちは数えない。
  const friend = await db
    .prepare('SELECT line_account_id FROM friends WHERE id = ?')
    .bind(event.friendId)
    .first<{ line_account_id: string | null }>();
  if (!friend) return { ...empty, skipped: 'friend_not_found' };
  const accountId = event.lineAccountId?.trim() || friend.line_account_id;
  if (!accountId || friend.line_account_id !== accountId) {
    return { ...empty, skipped: 'account_mismatch' };
  }

  // 計測中の地点だけ拾う。停止中は除外し、アカウント未指定の地点は全店共通として拾う。
  const points = await db
    .prepare(
      `SELECT id FROM conversion_points
        WHERE event_type = ?
          AND status = 'active'
          AND (line_account_id IS NULL OR line_account_id = ?)`,
    )
    .bind(event.sourceType, accountId)
    .all<ConversionPointRow>();

  const key = idempotencyKey(event.sourceType, event.sourceEventId);
  const metadata = JSON.stringify({ sourceType: event.sourceType, ...(event.metadata ?? {}) });
  let recorded = 0;
  let failed = 0;
  for (const point of points.results) {
    try {
      await trackConversion(db, {
        conversionPointId: point.id,
        friendId: event.friendId,
        metadata,
        idempotencyKey: key,
      });
      recorded += 1;
    } catch (error) {
      failed += 1;
      console.error('conversion source record failed:', {
        sourceType: event.sourceType,
        conversionPointId: point.id,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
  return { matched: points.results.length, recorded, failed, skipped: null };
}
