import { trackConversion } from './conversions.js';

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
 *
 * **なぜ apps/worker ではなく packages/db に置くか(#648 の差し戻し)。**
 * 「タグが付いた」を数える口を worker のサービスに置いたところ、
 * `attachTagAndFireSideEffects` を通る経路でしか数えられず、友だち詳細画面の
 * 手動タグ付けやオートメーションのタグ付けアクション(いずれも db の
 * `addTagToFriend` を直に呼ぶ)では 0 件のままだった。マイル加算が経路を
 * 問わず効いているのは、`addTagToFriend` の中(= db の層)で積んでいるため。
 * 成果計測も同じ層へ下ろすことで、呼び出し元を1つも触らずに全経路へ届く。
 * この関数が外から使うのは同じ package の trackConversion だけで、
 * worker のものは1つも使わない。
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

/**
 * 友だち1行と、その友だちで数えられる地点を1文で引いた結果。
 *
 * 地点が無いときも友だちの行は返る(LEFT JOIN)。そのとき point_id は NULL に
 * なるので、「友だちが居ない」と「地点が無い」を1回の往復で見分けられる。
 */
interface FriendPointRow {
  friend_account_id: string | null;
  point_id: string | null;
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

  /*
   * 友だちの所属と、数えられる地点を **1回の往復で** 引く(#648 の差し戻し)。
   *
   * この関数はタグが1本新しく付くたびに走る。友だちを引いてから地点を引く
   * 2回の形だと、一括タグ付けで N 件付けたときに 2N 回の往復になる。
   * LEFT JOIN 1本にすると N 回で済む。
   *
   * 地点の絞り込み(停止中を外す・起点の一致・アカウントの一致)は
   * **この SQL が正本**。アカウントは友だちの所属で突き合わせる。
   * 申告アカウントとの食い違いは、行を受け取ったあとで弾く(下)。
   *
   * compound SELECT(UNION 系)は使っていないので、D1 の上限5項には触れない。
   */
  const rows = await db
    .prepare(
      `SELECT f.line_account_id AS friend_account_id,
              cp.id             AS point_id
         FROM friends f
         LEFT JOIN conversion_points cp
                ON cp.event_type = ?
               AND cp.status = 'active'
               AND (cp.line_account_id IS NULL OR cp.line_account_id = f.line_account_id)
        WHERE f.id = ?`,
    )
    .bind(event.sourceType, event.friendId)
    .all<FriendPointRow>();

  const found = rows.results;
  if (found.length === 0) return { ...empty, skipped: 'friend_not_found' };

  // 申告アカウントと違う友だちは数えない。申告が無いときは友だちの所属を使う。
  const friendAccountId = found[0].friend_account_id;
  const accountId = event.lineAccountId?.trim() || friendAccountId;
  if (!accountId || friendAccountId !== accountId) {
    return { ...empty, skipped: 'account_mismatch' };
  }

  const points = found.filter((row): row is FriendPointRow & { point_id: string } =>
    row.point_id !== null);

  const key = idempotencyKey(event.sourceType, event.sourceEventId);
  const metadata = JSON.stringify({ sourceType: event.sourceType, ...(event.metadata ?? {}) });
  let recorded = 0;
  let failed = 0;
  for (const point of points) {
    try {
      await trackConversion(db, {
        conversionPointId: point.point_id,
        friendId: event.friendId,
        metadata,
        idempotencyKey: key,
      });
      recorded += 1;
    } catch (error) {
      failed += 1;
      console.error('conversion source record failed:', {
        sourceType: event.sourceType,
        conversionPointId: point.point_id,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
  return { matched: points.length, recorded, failed, skipped: null };
}
