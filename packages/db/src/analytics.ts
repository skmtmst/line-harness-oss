/**
 * 集計。
 *
 * 新しいテーブルは作らない。messages_log / link_clicks / broadcast_insights /
 * friend_tags / friend_field_values を、その場で数える。
 *
 * 集計結果を貯めるテーブルを作ると、貯めた値と元データがずれたときに
 * どちらが正しいのか分からなくなる。件数が増えて重くなってから考える。
 */

/** 期間。JSTの ISO 文字列で受ける。 */
export interface DateRange {
  from: string;
  to: string;
}

export interface DailyMessageCount {
  date: string;
  outgoing: number;
  incoming: number;
  /** 応答メッセージ。LINE の課金対象外 */
  reply: number;
  /** プッシュ。LINE の課金対象 */
  push: number;
  /** 一斉配信から出た送信 */
  fromBroadcast: number;
  /** シナリオから出た送信 */
  fromScenario: number;
}

/**
 * 日ごとの送受信数。
 *
 * created_at は JST の文字列なので、先頭10文字を取れば日付になる。
 * date() 関数を通すと UTC として解釈され、日本の朝9時より前が前日に寄る。
 *
 * reply と push は `delivery_type` から数える。**この2つを足しても outgoing に
 * ならないことがある。** delivery_type が入る前に記録された行と、テスト送信
 * （'test'）がどちらにも入らないため。画面の「合計」は outgoing を使うこと。
 */
export async function getDailyMessageCounts(
  db: D1Database,
  range: DateRange,
): Promise<DailyMessageCount[]> {
  const result = await db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS date,
              SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing,
              SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) AS incoming,
              SUM(CASE WHEN direction = 'outgoing' AND delivery_type = 'reply' THEN 1 ELSE 0 END) AS reply,
              SUM(CASE WHEN direction = 'outgoing' AND delivery_type = 'push' THEN 1 ELSE 0 END) AS push,
              SUM(CASE WHEN direction = 'outgoing' AND broadcast_id IS NOT NULL THEN 1 ELSE 0 END) AS from_broadcast,
              SUM(CASE WHEN direction = 'outgoing' AND scenario_step_id IS NOT NULL THEN 1 ELSE 0 END) AS from_scenario
         FROM messages_log
        WHERE created_at >= ? AND created_at <= ?
        GROUP BY substr(created_at, 1, 10)
        ORDER BY date ASC`,
    )
    .bind(range.from, range.to)
    .all<{
      date: string;
      outgoing: number;
      incoming: number;
      reply: number;
      push: number;
      from_broadcast: number;
      from_scenario: number;
    }>();
  return result.results.map((r) => ({
    date: r.date,
    outgoing: Number(r.outgoing ?? 0),
    incoming: Number(r.incoming ?? 0),
    reply: Number(r.reply ?? 0),
    push: Number(r.push ?? 0),
    fromBroadcast: Number(r.from_broadcast ?? 0),
    fromScenario: Number(r.from_scenario ?? 0),
  }));
}

export interface LinkClickSummary {
  trackedLinkId: string;
  name: string;
  clicks: number;
  uniqueFriends: number;
}

/**
 * リンクごとのクリック数。
 *
 * 友だちが分からないクリック（LINEの外から踏まれたもの）も clicks には数える。
 * uniqueFriends は分かったぶんだけ。「クリックはあるのに人数が0」は
 * 正しい状態で、隠すと数字が合わなくなる。
 */
export async function getLinkClickSummary(
  db: D1Database,
  range: DateRange,
  limit = 50,
): Promise<LinkClickSummary[]> {
  const result = await db
    .prepare(
      `SELECT c.tracked_link_id AS tracked_link_id,
              COALESCE(l.name, '(削除済み)') AS name,
              COUNT(*) AS clicks,
              COUNT(DISTINCT c.friend_id) AS unique_friends
         FROM link_clicks c
         LEFT JOIN tracked_links l ON l.id = c.tracked_link_id
        WHERE c.clicked_at >= ? AND c.clicked_at <= ?
        GROUP BY c.tracked_link_id
        ORDER BY clicks DESC
        LIMIT ?`,
    )
    .bind(range.from, range.to, limit)
    .all<{ tracked_link_id: string; name: string; clicks: number; unique_friends: number }>();
  return result.results.map((r) => ({
    trackedLinkId: r.tracked_link_id,
    name: r.name,
    clicks: Number(r.clicks ?? 0),
    uniqueFriends: Number(r.unique_friends ?? 0),
  }));
}

export interface TrackedLinkStat {
  trackedLinkId: string;
  name: string;
  /** 飛び先。tracked_links.original_url */
  originalUrl: string;
  /** 短縮URLの末尾。未発行なら null */
  shortCode: string | null;
  /** 押されたときに付くタグの名前。無ければ null */
  tagName: string | null;
  /** 押されたときに始まるシナリオの名前。無ければ null */
  scenarioName: string | null;
  isActive: boolean;
  clicks: number;
  uniqueFriends: number;
}

/**
 * 測定中のURLと、その期間のクリック数。
 *
 * `getLinkClickSummary` と違い、**1回も押されていないURLも返す**。
 * 「作ったのに誰にも押されていない」ことが分からないと、配信に入れ忘れた
 * のか、押されないのかを区別できない。
 *
 * 代わりに、消えた tracked_link に対するクリックはここには出ない。
 * そちらは `getLinkClickSummary` が拾う。
 */
export async function getTrackedLinkStats(
  db: D1Database,
  range: DateRange,
  limit = 200,
): Promise<TrackedLinkStat[]> {
  const result = await db
    .prepare(
      `SELECT l.id AS tracked_link_id,
              l.name AS name,
              l.original_url AS original_url,
              l.short_code AS short_code,
              t.name AS tag_name,
              s.name AS scenario_name,
              l.is_active AS is_active,
              COUNT(c.id) AS clicks,
              COUNT(DISTINCT c.friend_id) AS unique_friends
         FROM tracked_links l
         LEFT JOIN link_clicks c
                ON c.tracked_link_id = l.id
               AND c.clicked_at >= ? AND c.clicked_at <= ?
         LEFT JOIN tags t ON t.id = l.tag_id
         LEFT JOIN scenarios s ON s.id = l.scenario_id
        GROUP BY l.id
        ORDER BY clicks DESC, l.name ASC
        LIMIT ?`,
    )
    .bind(range.from, range.to, limit)
    .all<{
      tracked_link_id: string;
      name: string;
      original_url: string;
      short_code: string | null;
      tag_name: string | null;
      scenario_name: string | null;
      is_active: number;
      clicks: number;
      unique_friends: number;
    }>();
  return result.results.map((r) => ({
    trackedLinkId: r.tracked_link_id,
    name: r.name,
    originalUrl: r.original_url,
    shortCode: r.short_code,
    tagName: r.tag_name,
    scenarioName: r.scenario_name,
    isActive: r.is_active === 1,
    clicks: Number(r.clicks ?? 0),
    uniqueFriends: Number(r.unique_friends ?? 0),
  }));
}

export interface BroadcastSummary {
  broadcastId: string;
  name: string;
  sentAt: string | null;
  delivered: number | null;
  uniqueImpression: number | null;
  uniqueClick: number | null;
  /** LINEの制約で20人未満は開封が取れない。取れなかったことを画面に伝える */
  suppressedByAudienceSize: boolean;
}

/** 20人未満だと開封・クリックが取れない、というLINE側の決まり。 */
export const INSIGHT_MIN_AUDIENCE = 20;

/**
 * 配信ごとの成績。
 *
 * 20人未満の配信は開封が null で返る。0 として描くと「誰も読んでいない」に
 * 見えるので、取れなかったことが分かる形で返す。
 */
export async function getBroadcastSummary(
  db: D1Database,
  range: DateRange,
  limit = 50,
): Promise<BroadcastSummary[]> {
  const result = await db
    .prepare(
      `SELECT b.id AS broadcast_id, b.title AS name, b.sent_at AS sent_at,
              i.delivered, i.unique_impression, i.unique_click
         FROM broadcasts b
         LEFT JOIN broadcast_insights i ON i.broadcast_id = b.id
        WHERE b.sent_at IS NOT NULL AND b.sent_at >= ? AND b.sent_at <= ?
        ORDER BY b.sent_at DESC
        LIMIT ?`,
    )
    .bind(range.from, range.to, limit)
    .all<{
      broadcast_id: string;
      name: string;
      sent_at: string | null;
      delivered: number | null;
      unique_impression: number | null;
      unique_click: number | null;
    }>();
  return result.results.map((r) => ({
    broadcastId: r.broadcast_id,
    name: r.name,
    sentAt: r.sent_at,
    delivered: r.delivered,
    uniqueImpression: r.unique_impression,
    uniqueClick: r.unique_click,
    suppressedByAudienceSize:
      r.unique_impression == null && (r.delivered ?? 0) > 0 && (r.delivered ?? 0) < INSIGHT_MIN_AUDIENCE,
  }));
}

export interface CrossCell {
  row: string;
  col: string;
  count: number;
}

/**
 * クロス集計。タグ × 情報欄の値。
 *
 * 行にタグ、列に情報欄の値を置く。「犬を飼っている人のうち、
 * どのタグが多いか」のような見方をするため。
 *
 * 対象は値が入っている人だけ。空欄を「未設定」という値として数えると、
 * 表のほとんどが未設定で埋まって何も読み取れなくなる。
 */
export async function getTagFieldCross(
  db: D1Database,
  fieldId: string,
  limit = 400,
): Promise<CrossCell[]> {
  const result = await db
    .prepare(
      `SELECT t.name AS row_label, v.value AS col_label, COUNT(*) AS c
         FROM friend_field_values v
         JOIN friend_tags ft ON ft.friend_id = v.friend_id
         JOIN tags t ON t.id = ft.tag_id
        WHERE v.field_id = ? AND v.value IS NOT NULL AND v.value != ''
        GROUP BY t.name, v.value
        ORDER BY c DESC
        LIMIT ?`,
    )
    .bind(fieldId, limit)
    .all<{ row_label: string; col_label: string; c: number }>();
  return result.results.map((r) => ({
    row: r.row_label,
    col: r.col_label,
    count: Number(r.c ?? 0),
  }));
}

export interface FunnelResultStep {
  stepOrder: number;
  label: string;
  reached: number;
  /** 前の段から何割が進んだか。1段目は 1 */
  conversionFromPrevious: number;
}

/**
 * ファネルの結果を組み立てる。
 *
 * 各段で「前の段を通った人のうち、この段の条件を満たした人」を数える。
 * 段ごとに独立して数えると、途中を飛ばした人まで含まれて、
 * 下の段が上の段より多いという読めない表になる。
 */
export function buildFunnelResult(
  steps: Array<{ step_order: number; label: string }>,
  reachedPerStep: string[][],
): FunnelResultStep[] {
  const out: FunnelResultStep[] = [];
  let previous: number | null = null;
  for (let i = 0; i < steps.length; i++) {
    const reached = reachedPerStep[i]?.length ?? 0;
    out.push({
      stepOrder: steps[i].step_order,
      label: steps[i].label,
      reached,
      // 前の段が0人なら割合は出せない。0除算を避けて0にする。
      conversionFromPrevious: previous === null ? 1 : previous === 0 ? 0 : reached / previous,
    });
    previous = reached;
  }
  return out;
}
