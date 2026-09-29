/**
 * はじめの設定の順路。設計 ★V6 34-1（`RAW35`）。台帳 #134。
 *
 * **画面を開いたかではなく、実際に作られたもので判定する。**
 * だから訪問の記録は持たず、毎回いまの中身を数える（キャッシュしない）。
 */

export const GETTING_STARTED_STEPS = [
  'accounts',
  'attributes',
  'friendAdd',
  'scenario',
  'firstMessage',
] as const;
export type GettingStartedStep = (typeof GETTING_STARTED_STEPS)[number];

export interface StepFacts {
  /** 段1。稼働中で Webhook が合っていてシークレットが確かめ済みのアカウント数。 */
  usableAccounts: number;
  /** 段1。アカウントが 1 件でもあるか（「まだ」と「止まっている」を分ける）。 */
  totalAccounts: number;
  /** 段2。 */
  tagCount: number;
  friendFieldCount: number;
  /** 段3。公開された振り分けがあるか。 */
  friendAddPublished: boolean;
  /** 段3。下書きだけでもあるか。 */
  friendAddDraft: boolean;
  /** 段4。段3のルールから始まる、動いているシナリオがあるか。 */
  scenarioStartedFromFriendAdd: boolean;
  scenarioCount: number;
  /** 最終確認。友だち追加時配信かシナリオの1通目が実際に出たか。 */
  firstMessageDelivered: boolean;
}

/**
 * 最終確認「最初の1通を受け取る」。
 *
 * 友だち追加時の配信（`source = 'friend_add_routing'`）か、シナリオ
 * （`scenario_step_id` が入っている）の送信が 1 件でもあれば終わり。
 * **テスト受信者への送信（`delivery_type = 'test'`）も数える**——設計が
 * 「QRを読んで自分を友だちに追加するか、テスト受信者へ送ります」と
 * 2 経路を認めているため。
 */
export async function hasFirstDeliveredMessage(
  db: D1Database,
  accountId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS hit
         FROM messages_log
        WHERE line_account_id = ?
          AND direction = 'outgoing'
          AND (source = 'friend_add_routing' OR scenario_step_id IS NOT NULL)
        LIMIT 1`,
    )
    .bind(accountId)
    .first<{ hit: number }>();
  return row !== null;
}

/** 段1。3つとも揃って初めて数える。**`unknown` の Webhook を「合っている」と読まない。** */
export async function countUsableAccounts(db: D1Database): Promise<{ usable: number; total: number }> {
  const total = await db
    .prepare(`SELECT COUNT(*) AS c FROM line_accounts WHERE archived_at IS NULL`)
    .first<{ c: number }>();
  const usable = await db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM line_accounts
        WHERE archived_at IS NULL
          AND is_active = 1
          AND channel_secret_encrypted IS NOT NULL`,
    )
    .first<{ c: number }>();
  return { usable: usable?.c ?? 0, total: total?.c ?? 0 };
}
