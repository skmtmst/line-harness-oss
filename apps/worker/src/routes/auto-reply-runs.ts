import { Hono } from 'hono';
import {
  getAutoReplies,
  getAutoReplyEvaluationSummary,
  getAutoReplyTriggerBreakdown,
  listAutoReplyEvaluationRuns,
  type AutoReplyEvaluationStatus,
  type AutoReplyRunListRow,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

const autoReplyRuns = new Hono<Env>();

type ExecutionRunStatus =
  | 'queued'
  | 'claimed'
  | 'succeeded'
  | 'skipped'
  | 'retry_wait'
  | 'permanent_failed'
  | 'cancelled';

interface AutoReplyRun {
  id: string;
  ownerKind: 'auto_reply';
  ownerId: string;
  lineAccountId: string | null;
  occurredAt: string;
  subject: string | null;
  accountLabel: string | null;
  triggerLabel: string;
  reference: string | null;
  status: ExecutionRunStatus;
  detail: string | null;
  durationMs: number | null;
  canRetry: boolean;
  autoReplyId: string | null;
  autoReplyName: string | null;
  friendId: string;
  friendName: string | null;
  messageKind: string;
  inputPreview: string | null;
  matchedKeyword: string | null;
  versionNumber: number | null;
  domainStatus: AutoReplyEvaluationStatus;
  replyStatus: 'not_attempted' | 'accepted' | 'failed';
  actionSummary: Record<string, number>;
  lineRequestId: string | null;
}

interface AutoReplyRunsResponse {
  rule: {
    id: string | null;
    name: string;
    isActive: boolean | null;
    priorityPosition: number | null;
  };
  summary: {
    monthHits: number;
    totalHits: number;
    handovers: number;
    errors: number;
    lastRunAt: string | null;
    averageResponseMs: number | null;
  };
  handovers: { waiting: number; inProgress: number; completed: number };
  triggerBreakdown: Array<{ trigger: string; count: number; share: number | null }>;
  items: AutoReplyRun[];
  pagination: { total: number; limit: number; offset: number };
}

const DOMAIN_STATUSES = new Set<AutoReplyEvaluationStatus>([
  'received',
  'evaluated',
  'matched',
  'skipped',
  'reply_accepted',
  'reply_failed',
  'actions_running',
  'completed',
  'partial_failed',
  'failed',
]);

function commonStatus(status: AutoReplyEvaluationStatus): ExecutionRunStatus {
  if (status === 'completed' || status === 'reply_accepted') return 'succeeded';
  if (status === 'reply_failed' || status === 'partial_failed' || status === 'failed') {
    return 'permanent_failed';
  }
  if (status === 'skipped') return 'skipped';
  return 'claimed';
}

const SKIP_LABELS: Record<string, string> = {
  no_matching_rule: '条件に合うルールがありませんでした',
  message_kind_not_matched: '対象のメッセージ種類ではありませんでした',
  keyword_not_matched: 'キーワードに一致しませんでした',
  outside_active_window: '応答する時間帯の外でした',
  weekday_not_allowed: '応答しない曜日でした',
  operator_handling: '担当者が対応中のため何もしませんでした',
  already_replied_once: '1人1回の設定により何もしませんでした',
  cooldown_active: '連続返信を防ぐため何もしませんでした',
  friend_conditions_not_met: '友だちの条件に合いませんでした',
};

function effectiveDomainStatus(row: AutoReplyRunListRow): AutoReplyEvaluationStatus {
  // 選択したルールが条件で見送られ、その後ろのルールが動いた場合でも、
  // この画面では「選択したルールは何もしなかった」と表示する。
  return row.candidate_result === 'skipped' ? 'skipped' : row.status;
}

function detail(row: AutoReplyRunListRow, status: AutoReplyEvaluationStatus): string | null {
  if (status === 'skipped') {
    let candidateReason: string | null = null;
    try {
      const reasons = JSON.parse(row.candidate_reason_codes ?? '[]') as unknown;
      candidateReason = Array.isArray(reasons) && typeof reasons[0] === 'string' ? reasons[0] : null;
    } catch {
      candidateReason = null;
    }
    return SKIP_LABELS[candidateReason ?? row.skip_reason ?? ''] ?? '条件に合わず何もしませんでした';
  }
  if (row.status === 'reply_failed') return 'LINEへの返信を受け付けてもらえませんでした';
  if (row.status === 'partial_failed') return '返信または一部の処理だけ完了しました';
  if (row.status === 'failed') return '自動応答を完了できませんでした';
  if (row.status === 'completed') return '返信と設定した処理が完了しました';
  return '処理中です';
}

function parseActionSummary(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        typeof item === 'number' && Number.isFinite(item) ? [[key, item]] : []),
    );
  } catch {
    return {};
  }
}

function serializeRun(
  row: AutoReplyRunListRow,
  selectedRule?: { id: string; name: string | null; keyword: string },
  canViewInput = false,
): AutoReplyRun {
  const domainStatus = effectiveDomainStatus(row);
  return {
    id: row.id,
    ownerKind: 'auto_reply',
    ownerId: selectedRule?.id ?? row.winning_auto_reply_id ?? '',
    lineAccountId: row.line_account_id,
    occurredAt: row.evaluated_at,
    subject: row.friend_name,
    accountLabel: row.account_label,
    triggerLabel: row.matched_keyword ?? (row.status === 'skipped' ? '条件に合いませんでした' : '確認中'),
    reference: row.incoming_message_log_id,
    status: commonStatus(domainStatus),
    detail: detail(row, domainStatus),
    durationMs: row.duration_ms,
    canRetry: false,
    autoReplyId: selectedRule?.id ?? row.winning_auto_reply_id,
    autoReplyName: selectedRule?.name || selectedRule?.keyword || row.rule_name,
    friendId: row.friend_id,
    friendName: row.friend_name,
    messageKind: row.message_kind,
    inputPreview: canViewInput ? row.input_preview_masked : null,
    matchedKeyword: row.matched_keyword,
    versionNumber: row.version_number,
    domainStatus,
    replyStatus: row.reply_status,
    actionSummary: parseActionSummary(row.action_summary),
    lineRequestId: row.line_request_id,
  };
}

function boundedInteger(raw: string | undefined, fallback: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return Math.min(value, max);
}

async function normalizedSearchHash(value: string): Promise<string> {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** UTCで保存した受信時刻を、日本の月境界に合わせて集計する。 */
function currentJstMonthUtcRange(now: Date): { from: string; to: string } {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  const from = new Date(Date.UTC(year, month, 1) - 9 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.UTC(year, month + 1, 1) - 9 * 60 * 60 * 1000).toISOString();
  return { from, to };
}

autoReplyRuns.get(
  '/api/auto-reply-runs',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
      const requestedRuleId = c.req.query('rule_id') || c.req.query('ruleId') || undefined;
      const allRules = await getAutoReplies(c.env.DB);
      const visibleRules = allRules.filter((rule) =>
        rule.line_account_id == null
          ? scope.canSeeUnassigned
          : scope.allowedAccountIds.includes(rule.line_account_id),
      );
      const selectedRule = requestedRuleId
        ? visibleRules.find((rule) => rule.id === requestedRuleId)
        : undefined;
      if (requestedRuleId && !selectedRule) {
        return c.json({ success: false, error: '自動応答が見つかりません' }, 404);
      }

      const statusRaw = c.req.query('status');
      const status = statusRaw && DOMAIN_STATUSES.has(statusRaw as AutoReplyEvaluationStatus)
        ? statusRaw as AutoReplyEvaluationStatus
        : undefined;
      const limit = Math.max(1, boundedInteger(c.req.query('limit'), 20, 100));
      const offset = boundedInteger(c.req.query('offset'), 0, 1_000_000);
      const search = c.req.query('search')?.trim() || undefined;
      const staff = c.get('staff');
      const canViewInput = staff.role !== 'staff' || staff.permissionKeys?.includes('/chats') === true;
      const shared = {
        ruleId: selectedRule?.id,
        lineAccountIds: scope.allowedAccountIds,
        includeUnassigned: scope.canSeeUnassigned,
      };
      const month = currentJstMonthUtcRange(new Date());
      const [runs, summary, breakdown] = await Promise.all([
        listAutoReplyEvaluationRuns(c.env.DB, {
          ...shared,
          status,
          search,
          normalizedTextHash: search && canViewInput ? await normalizedSearchHash(search) : undefined,
          limit,
          offset,
        }),
        getAutoReplyEvaluationSummary(c.env.DB, {
          ...shared,
          monthFrom: month.from,
          monthTo: month.to,
        }),
        getAutoReplyTriggerBreakdown(c.env.DB, { ...shared, limit: 10 }),
      ]);
      const breakdownTotal = breakdown.reduce((sum, item) => sum + item.count, 0);
      const priorityPosition = selectedRule
        ? visibleRules
          .filter((rule) => rule.is_active === 1)
          .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
          .findIndex((rule) => rule.id === selectedRule.id) + 1
        : null;

      const data: AutoReplyRunsResponse = {
        rule: {
          id: selectedRule?.id ?? null,
          name: selectedRule?.name || selectedRule?.keyword || '自動応答',
          isActive: selectedRule ? selectedRule.is_active === 1 : null,
          priorityPosition: priorityPosition && priorityPosition > 0 ? priorityPosition : null,
        },
        summary: {
          monthHits: summary.monthHits,
          totalHits: summary.totalHits,
          handovers: summary.handovers,
          errors: summary.errors,
          lastRunAt: summary.lastRunAt,
          averageResponseMs: summary.averageResponseMs,
        },
        handovers: {
          waiting: summary.handoverWaiting,
          inProgress: summary.handoverInProgress,
          completed: summary.handoverCompleted,
        },
        triggerBreakdown: breakdown.map((item) => ({
          ...item,
          share: breakdownTotal > 0 ? item.count / breakdownTotal : null,
        })),
        items: runs.items.map((row) => serializeRun(
          row,
          selectedRule,
          canViewInput,
        )),
        pagination: { total: runs.total, limit, offset },
      };
      return c.json({ success: true, data });
    } catch (error) {
      console.error('GET /api/auto-reply-runs failed', error);
      return c.json({ success: false, error: '自動応答の実行結果を表示できませんでした' }, 500);
    }
  },
);

export { autoReplyRuns };
