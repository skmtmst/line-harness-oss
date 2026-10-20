import { sqlIdSet } from './id-queries.js';
/**
 * ダッシュボードが1回で読む数。
 *
 * 設計（Pen.dev `V2 1-1 ダッシュボード`）は1画面に10か所以上の数を出す。
 * 画面から個別に叩くと往復が増えるうえ、カードごとに数の基準日がずれる。
 * 「有効友だちは今朝の値、未対応は今の値」のような画面は読み違えのもとなので、
 * 1回のリクエストでまとめて返す。
 */
import { FORM_SUBMIT_CLAIM_STALE_MS } from './forms/index.js';
import { toJstString } from './utils.js';
import { type AccountStatsScope, type ListStats } from './dashboard-types.js';
import { jstDate, nextMonth } from './dashboard-freshness.js';
import { accountScopeSql, getInboxStatusCounts, count } from './dashboard-inbox.js';


export async function getListStats(db: D1Database, scope: AccountStatsScope): Promise<ListStats> {
  const monthStart = jstDate(0).slice(0, 7);
  const ninetyDaysAgo = jstDate(-90);
  const friendScope = accountScopeSql(scope, 'f.line_account_id');
  const messageScope = accountScopeSql(scope, 'line_account_id');
  const scenarioScope = accountScopeSql(scope, 'line_account_id');
  const reminderScope = accountScopeSql(scope, 'line_account_id');
  // reminder_delivery_runs にも line_account_id があるので、JOIN内では実施側の列で絞る。
  const reminderRunScope = accountScopeSql(scope, 'rdr.line_account_id');
  const markScope = 'allTenants' in scope
    ? { sql: '1 = 1', binds: [] as string[] }
    : scope.allowedAccountIds.length > 0
      ? {
          sql: `(sms.line_account_id IN (${sqlIdSet(scope.allowedAccountIds).sql}) OR sms.line_account_id IS NULL)`,
          binds: sqlIdSet(scope.allowedAccountIds).binds,
        }
      : { sql: 'sms.line_account_id IS NULL', binds: [] as string[] };

  const safe = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch {
      // 機能を切っている環境では表が無い。その画面の数だけ 0 になる。
      return fallback;
    }
  };

  const [tags, marks, searches, templates, scenarios, reminders, forms] = await Promise.all([
    safe(async () => {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM tags) AS total,
             (SELECT COUNT(*) FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM friend_tags)) AS unused,
             (SELECT COUNT(DISTINCT ft.friend_id) FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id WHERE ${friendScope.sql}) AS tagged,
             (SELECT COUNT(*) FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id WHERE ft.assigned_at >= ? AND ft.assigned_at < ? AND ${friendScope.sql}) AS this_month`,
        )
        .bind(...friendScope.binds, `${monthStart}-01`, `${nextMonth(monthStart)}-01`, ...friendScope.binds)
        .first<{ total: number; unused: number; tagged: number; this_month: number }>();
      return {
        total: row?.total ?? 0,
        unused: row?.unused ?? 0,
        taggedFriends: row?.tagged ?? 0,
        assignedThisMonth: row?.this_month ?? 0,
      };
    }, { total: 0, unused: 0, taggedFriends: 0, assignedThisMonth: 0 }),

    safe(async () => {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(DISTINCT sm.id)
                FROM support_marks sm
                LEFT JOIN support_mark_scopes sms ON sms.mark_id = sm.id
               WHERE sm.archived_at IS NULL AND ${markScope.sql}) AS total,
             (SELECT COUNT(DISTINCT f.support_mark_id) FROM friends f WHERE f.support_mark_id IS NOT NULL AND ${friendScope.sql}) AS in_use`,
        )
        .bind(...markScope.binds, ...friendScope.binds)
        .first<{ total: number; in_use: number }>();
      // #1014 ATTR-21: 「未対応◯%」の母数は受信箱全体（unread＋対応中＋
      // 保留＋対応済み）。数え方は受信箱の正本（getInboxStatusCounts）の
      // LINE 側を使う。MAIL のスレッドは友だち属性の母数に混ぜない。
      const inbox = (await getInboxStatusCounts(db, scope)).line;
      // 変更履歴も、対象の友だちが属するアカウントで絞る。
      const changed = await db
        .prepare(
          `SELECT COUNT(*) AS n
             FROM operation_audit oa
             JOIN friends f ON f.id = oa.friend_id
            WHERE oa.target_kind = 'support_mark'
              AND oa.action = 'changed'
              AND substr(oa.created_at, 1, 10) >= ?
              AND ${friendScope.sql}`,
        )
        .bind(jstDate(-6), ...friendScope.binds)
        .first<{ n: number }>();
      const changedLast7 = changed?.n ?? 0;
      return {
        total: row?.total ?? 0,
        inUse: row?.in_use ?? 0,
        unanswered: inbox.unanswered,
        inProgress: inbox.inProgress,
        onHold: inbox.onHold,
        resolved: inbox.resolved,
        changedLast7,
      };
    }, { total: 0, inUse: 0, unanswered: 0, inProgress: 0, onHold: 0, resolved: 0, changedLast7: 0 }),

    safe(async () => {
      // 上限50は画面に出すためだけの値。DB側に制約は無い。
      // 実際に増えすぎたら、ここではなく保存時に止める話になる。
      const total = await count(db, `SELECT COUNT(*) AS n FROM saved_searches`);
      return { total, limit: 50 };
    }, { total: 0, limit: 50 }),

    safe(async () => {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM templates) AS total,
             -- テンプレート由来だけを数える。template_id_at_send は 038 で入っている。
             -- 全送信を出すと、テンプレートを使っていない手動返信まで混ざる。
             (SELECT COUNT(*) FROM messages_log
               WHERE direction = 'outgoing'
                 AND template_id_at_send IS NOT NULL
                 AND created_at >= ? AND created_at < ? AND ${messageScope.sql}) AS sent`,
        )
        .bind(`${monthStart}-01`, `${nextMonth(monthStart)}-01`, ...messageScope.binds)
        .first<{ total: number; sent: number }>();
      // 「使用中」は、シナリオのステップか自動応答から参照されているもの。
      const used = await count(
        db,
        `SELECT COUNT(DISTINCT template_id) AS n FROM (
           SELECT template_id FROM scenario_steps WHERE template_id IS NOT NULL
           UNION ALL
           SELECT template_id FROM auto_replies WHERE template_id IS NOT NULL AND deleted_at IS NULL
         )`,
      );
      // テンプレート由来の短縮URLのクリック率（110）。
      //
      // 分母は「そのテンプレートを含む送信の数」ではなく、
      // 短縮URLが押された回数 ÷ テンプレート由来の送信数。
      // 1通に複数のURLが入ると100%を超えうるので、上限を100にする。
      let clickRate: number | null = null;
      try {
        const clicks = await count(
          db,
          `SELECT COALESCE(SUM(click_count), 0) AS n FROM tracked_links
            WHERE template_id IS NOT NULL AND ${accountScopeSql(scope, 'line_account_id').sql}`,
          ...accountScopeSql(scope, 'line_account_id').binds,
        );
        const sent = row?.sent ?? 0;
        clickRate = sent > 0 ? Math.min(100, Math.round((clicks / sent) * 1000) / 10) : null;
      } catch {
        // 110 がまだ当たっていない環境。クリック率だけ出ない。
      }
      return {
        total: row?.total ?? 0,
        inUse: used,
        sentThisMonth: row?.sent ?? 0,
        unused90d: Math.max(0, (row?.total ?? 0) - used),
        clickRate,
      };
    }, { total: 0, inUse: 0, sentThisMonth: 0, unused90d: 0, clickRate: null }),

    safe(async () => {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM scenarios WHERE ${scenarioScope.sql}) AS total,
             (SELECT COUNT(*) FROM scenarios WHERE is_active = 1 AND ${scenarioScope.sql}) AS active,
             (SELECT COUNT(*) FROM friend_scenarios fs JOIN friends f ON f.id = fs.friend_id WHERE fs.status = 'active' AND ${friendScope.sql}) AS subscribers,
             (SELECT COUNT(*) FROM friend_scenarios fs JOIN friends f ON f.id = fs.friend_id WHERE fs.status = 'completed' AND ${friendScope.sql}) AS completed`,
        )
        .bind(...scenarioScope.binds, ...scenarioScope.binds, ...friendScope.binds, ...friendScope.binds)
        .first<{ total: number; active: number; subscribers: number; completed: number }>();
      // シナリオ由来の送信。source は 028 で入っている。
      const sentThisWeek = await count(
        db,
        `SELECT COUNT(*) AS n FROM messages_log
          WHERE source = 'scenario' AND created_at >= ? AND ${messageScope.sql}`,
        jstDate(-6), ...messageScope.binds,
      );
      return {
        total: row?.total ?? 0,
        active: row?.active ?? 0,
        subscribers: row?.subscribers ?? 0,
        completed: row?.completed ?? 0,
        sentThisWeek,
      };
    }, { total: 0, active: 0, subscribers: 0, completed: 0, sentThisWeek: 0 }),

    safe(async () => {
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM reminders WHERE deleted_at IS NULL AND ${reminderScope.sql}) AS total,
             (SELECT COUNT(*) FROM reminders WHERE deleted_at IS NULL AND is_active = 1 AND ${reminderScope.sql}) AS active,
             (SELECT COUNT(*) FROM friend_reminders fr JOIN friends f ON f.id = fr.friend_id WHERE fr.status = 'active' AND ${friendScope.sql}) AS waiting,
             (SELECT COUNT(*) FROM reminder_delivery_runs rdr
               JOIN reminders rm ON rm.id = rdr.reminder_id
              WHERE rdr.status IN ('retry_wait', 'permanent_failed') AND rm.deleted_at IS NULL AND ${reminderRunScope.sql}) AS failed`,
        )
        .bind(...reminderScope.binds, ...reminderScope.binds, ...friendScope.binds, ...reminderRunScope.binds)
        .first<{ total: number; active: number; waiting: number; failed: number }>();
      // リマインダ由来の送信。source は 028 で入っている。
      const sentThisMonth = await count(
        db,
        `SELECT COUNT(*) AS n FROM messages_log
          WHERE source = 'reminder' AND created_at >= ? AND created_at < ? AND ${messageScope.sql}`,
        `${monthStart}-01`, `${nextMonth(monthStart)}-01`, ...messageScope.binds,
      );
      return {
        total: row?.total ?? 0,
        active: row?.active ?? 0,
        waiting: row?.waiting ?? 0,
        sentThisMonth,
        failed: row?.failed ?? 0,
      };
    }, { total: 0, active: 0, waiting: 0, sentThisMonth: 0, failed: 0 }),

    safe(async () => {
      // フォームはアカウント直下ではなく form_accounts(M:N) で持つ。
      // 一覧APIと同じ「そのアカウントに見えるフォーム」の範囲で数える。
      const formScope: { sql: string; binds: string[] } = 'allTenants' in scope
        ? { sql: '1 = 1', binds: [] }
        : scope.allowedAccountIds.length > 0
          ? {
              sql: `(EXISTS (
                      SELECT 1 FROM form_accounts fa
                      WHERE fa.form_id = f.id
                        AND fa.line_account_id IN (${sqlIdSet(scope.allowedAccountIds).sql})
                    )${scope.includeUnassigned
                      ? ` OR NOT EXISTS (
                          SELECT 1 FROM form_accounts unassigned_fa WHERE unassigned_fa.form_id = f.id
                        )`
                      : ''})`,
              binds: sqlIdSet(scope.allowedAccountIds).binds,
            }
          : scope.includeUnassigned
            ? {
                sql: `NOT EXISTS (
                        SELECT 1 FROM form_accounts unassigned_fa WHERE unassigned_fa.form_id = f.id
                      )`,
                binds: [],
              }
            : { sql: '1 = 0', binds: [] };
      // 先月（日本時間の暦月）。帯の「先月 640件」に使う。
      const [year, month] = monthStart.split('-').map(Number);
      const prevMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
      // 「止まった」とみなす目安は一覧の未完札と同じ。
      const staleBefore = toJstString(new Date(Date.now() - FORM_SUBMIT_CLAIM_STALE_MS));
      const row = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM forms f
               WHERE f.status = 'active' AND ${formScope.sql}) AS total,
             (SELECT COUNT(*) FROM forms f
               WHERE f.status = 'active' AND f.is_active = 1 AND ${formScope.sql}) AS published,
             (SELECT COUNT(*) FROM form_submissions fs JOIN forms f ON f.id = fs.form_id
               WHERE fs.is_test = 0 AND substr(fs.created_at, 1, 7) = ? AND ${formScope.sql}) AS monthly_submits,
             (SELECT COUNT(*) FROM form_submissions fs JOIN forms f ON f.id = fs.form_id
               WHERE fs.is_test = 0 AND substr(fs.created_at, 1, 7) = ? AND ${formScope.sql}) AS prev_month_submits,
             -- 開いた人はフォームごとの一意数の合計（行の「開いた人数」と同じ数え方）。
             (SELECT COUNT(*) FROM (
               SELECT DISTINCT fo.friend_id, fo.form_id
                 FROM form_opens fo JOIN forms f ON f.id = fo.form_id
                 WHERE fo.is_test = 0 AND fo.friend_id IS NOT NULL
                   AND substr(fo.opened_at, 1, 7) = ? AND ${formScope.sql}
             )) AS monthly_opens,
             (SELECT COUNT(*) FROM form_submit_claims c JOIN forms f ON f.id = c.form_id
               WHERE c.submission_id IS NOT NULL
                 AND (c.status = 'failed'
                   OR (c.status = 'in_progress' AND c.updated_at < ?))
                 AND ${formScope.sql}) AS pending_post_actions`,
        )
        .bind(
          ...formScope.binds,
          ...formScope.binds,
          monthStart, ...formScope.binds,
          prevMonth, ...formScope.binds,
          monthStart, ...formScope.binds,
          staleBefore, ...formScope.binds,
        )
        .first<{
          total: number;
          published: number;
          monthly_submits: number;
          prev_month_submits: number;
          monthly_opens: number;
          pending_post_actions: number;
        }>();
      const monthlyOpens = row?.monthly_opens ?? 0;
      const monthlySubmits = row?.monthly_submits ?? 0;
      return {
        total: row?.total ?? 0,
        published: row?.published ?? 0,
        draft: (row?.total ?? 0) - (row?.published ?? 0),
        monthlySubmits,
        prevMonthSubmits: row?.prev_month_submits ?? 0,
        monthlyCompletionRate: monthlyOpens === 0
          ? null
          : Math.round((monthlySubmits / monthlyOpens) * 1000) / 10,
        pendingPostActions: row?.pending_post_actions ?? 0,
      };
    }, {
      total: 0,
      published: 0,
      draft: 0,
      monthlySubmits: 0,
      prevMonthSubmits: 0,
      monthlyCompletionRate: null,
      pendingPostActions: 0,
    }),
  ]);

  void ninetyDaysAgo;
  return { tags, marks, searches, templates, scenarios, reminders, forms };
}
