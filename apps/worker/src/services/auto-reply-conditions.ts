/**
 * 自動応答を「返すかどうか」の判定。
 *
 * キーワードが一致しても返さない場合が3つある:
 *   1. 時間帯の外（営業時間外だけ返す、など）
 *   2. 直前に自動応答を返したばかり（連投の抑制）
 *   3. 担当者が対応中のトーク
 *
 * 時間帯の判定だけを純粋な関数として切り出しているのは、日をまたぐ設定
 * （22:00〜06:00）の扱いが一番間違えやすいところで、DBを用意せずに
 * 確かめられるようにしたいため。
 */

export interface AutoReplyConditionRow {
  active_from: string | null;
  active_until: string | null;
  cooldown_minutes: number | null;
  skip_when_operator_active: number;
}

/** JSTの現在時刻を "HH:MM" で返す。 */
export function jstHhmm(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const h = String(jst.getUTCHours()).padStart(2, '0');
  const m = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * 時間帯の中かどうか。
 *
 * 片方だけ設定されている場合は、設定された側だけを見る
 * （「18:00以降ずっと」「06:00までずっと」を書けるようにするため）。
 *
 * from > until のときは日をまたぐ指定として扱う。22:00〜06:00 を
 * 「22時から6時まで」と読むのは自然だが、単純な範囲比較だと
 * 常に偽になってしまう。営業時間外の自動応答はまさにこの形なので、
 * ここを取り違えると機能が丸ごと動かない。
 *
 * 境界は from を含み until を含まない。09:00〜18:00 と 18:00〜22:00 を
 * 並べたときに 18:00 が両方に入らないようにするため。
 */
export function isWithinActiveWindow(
  rule: Pick<AutoReplyConditionRow, 'active_from' | 'active_until'>,
  nowHhmm: string,
): boolean {
  const from = rule.active_from;
  const until = rule.active_until;
  if (!from && !until) return true;
  if (from && !until) return nowHhmm >= from;
  if (!from && until) return nowHhmm < until;
  // ここに来る時点で両方ある。
  if (from! < until!) return nowHhmm >= from! && nowHhmm < until!;
  if (from! > until!) return nowHhmm >= from! || nowHhmm < until!;
  // from === until。24時間を表すのか一瞬を表すのか読めないので、
  // 「時間帯を指定していない」と同じ扱いにする。返らない方が事故は
  // 大きい（問い合わせに何も返らなくなる）。
  return true;
}

/**
 * 連投抑制にかかっているか。
 *
 * 「このルールで前回返してから N 分」ではなく「この人へ自動応答を
 * 返してから N 分」で見る。ルールごとの送信記録を持っていないという
 * 事情もあるが、そもそも抑制の目的が「相手を機械の返信で埋めない」
 * ことなので、人単位で数えるのが目的に合う。
 */
export async function isCoolingDown(
  db: D1Database,
  friendId: string,
  cooldownMinutes: number | null,
  now: Date,
): Promise<boolean> {
  if (!cooldownMinutes || cooldownMinutes <= 0) return false;
  // messages_log.created_at は JST の文字列。比較する境界も同じ形にする。
  const since = new Date(now.getTime() + 9 * 60 * 60 * 1000 - cooldownMinutes * 60 * 1000)
    .toISOString()
    .replace('Z', '');
  // idx_messages_log_friend_source があるので friend_id + source は索引で引ける。
  const row = await db
    .prepare(
      `SELECT 1 FROM messages_log
        WHERE friend_id = ? AND source = 'auto_reply' AND created_at > ?
        LIMIT 1`,
    )
    .bind(friendId, since)
    .first<{ 1: number }>();
  return row != null;
}

/**
 * 担当者が対応中か。
 *
 * 「未読」は対応中ではない。誰も見ていないのに自動応答まで止まると、
 * 問い合わせが放置されたまま何も返らなくなる。
 */
export async function isOperatorHandling(
  db: D1Database,
  friendId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT status FROM chats WHERE friend_id = ? LIMIT 1`)
    .bind(friendId)
    .first<{ status: string }>();
  return row?.status === 'in_progress';
}

/**
 * 3つの条件をまとめて見る。返す場合だけ true。
 *
 * 順番は「安い順」。時間帯は問い合わせ不要、連投抑制と有人対応は
 * それぞれ1クエリなので、条件が設定されていなければ引かない。
 */
export async function shouldReply(
  db: D1Database,
  rule: AutoReplyConditionRow,
  friendId: string,
  now: Date,
): Promise<boolean> {
  if (!isWithinActiveWindow(rule, jstHhmm(now))) return false;
  if (rule.skip_when_operator_active === 1 && (await isOperatorHandling(db, friendId))) {
    return false;
  }
  if (await isCoolingDown(db, friendId, rule.cooldown_minutes, now)) return false;
  return true;
}
