import type { SegmentCondition } from './segment-query.js';
import { matchesCondition, parseCondition } from './segment-query.js';
import {
  processAutomationRun,
  startAutomationRun,
  type AutomationActionExecutor,
  type RunStatus,
} from './automation-engine.js';
import { createAutomationActionExecutors } from './automation-action-executors.js';

const EVENT_TRIGGER_TYPES = new Set([
  'friend_add',
  'tag_change',
  'message_received',
  'form_submitted',
  'link_clicked',
  'calendar_booked',
  'score_threshold_crossed',
  'score_band_changed',
  'manual_reply_sent',
  'staff_assigned',
  'response_overdue',
]);
const SUPPORT_MARK_TRIGGER_TYPE = 'support_mark_change';
const SUPPORT_MARK_EVENTS = new Set([
  'message_received',
  'manual_reply_sent',
  'staff_assigned',
  'response_overdue',
]);
const SCHEDULE_TRIGGER_TYPES = new Set(['datetime', 'daily', 'weekly']);
const EVENT_FILTER_KEYS: Record<string, ReadonlySet<string>> = {
  friend_add: new Set(),
  tag_change: new Set(['tagId', 'action']),
  message_received: new Set(),
  form_submitted: new Set(['formId']),
  link_clicked: new Set(['trackedLinkId']),
  calendar_booked: new Set(['bookingType', 'menuId', 'eventId']),
  score_threshold_crossed: new Set([
    'ruleId', 'ruleVersionId', 'scoreBefore', 'currentScore',
    'previousBand', 'currentBand', 'thresholdBand',
  ]),
  score_band_changed: new Set([
    'ruleId', 'ruleVersionId', 'scoreBefore', 'currentScore',
    'previousBand', 'currentBand',
  ]),
  manual_reply_sent: new Set(['staffId']),
  staff_assigned: new Set(['staffId']),
  response_overdue: new Set(['dueAt']),
};

interface AutomationCandidate {
  automation_id: string;
  priority: number;
  trigger_type: string;
  trigger_config: string;
  condition_config: string;
}

interface ScheduledCandidate extends AutomationCandidate {
  line_account_id: string;
  timezone: string;
}

export interface AutomationEventInput {
  lineAccountId: string;
  eventType: string;
  sourceEventId: string;
  friendId?: string | null;
  eventData?: Record<string, unknown>;
  lineAccessToken?: string;
}

export interface AutomationDispatchItem {
  automationId: string;
  runId: string | null;
  kind: 'created' | 'existing' | 'not_active' | 'configuration_error';
  status: RunStatus | 'busy' | 'not_found' | 'configuration_error' | null;
  error?: string;
}

export interface AutomationTriggerOptions {
  now?: string;
  executors?: Record<string, AutomationActionExecutor>;
  limit?: number;
  credentialEncryptionKey?: string;
}

function parseObject(raw: string, label: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // 下で設定エラーへ揃える。
  }
  throw new Error(`${label}_invalid`);
}

function parseTargetCondition(raw: string): SegmentCondition | null {
  const object = parseObject(raw, 'condition_config');
  if (Object.keys(object).length === 0) return null;
  const parsed = parseCondition(raw);
  if (!parsed) throw new Error('condition_config_invalid');
  return parsed;
}

function equalFilter(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (expected.length === 0 || expected.some((item) => typeof item !== 'string')) {
      throw new Error('trigger_config_filter_invalid');
    }
    return expected.includes(actual);
  }
  if (typeof expected !== 'string' || !expected) throw new Error('trigger_config_filter_invalid');
  return actual === expected;
}

function matchesEventTrigger(candidate: AutomationCandidate, input: AutomationEventInput): boolean {
  if (candidate.trigger_type === SUPPORT_MARK_TRIGGER_TYPE) {
    const config = parseObject(candidate.trigger_config, 'trigger_config');
    const event = typeof config.event === 'string' ? config.event : '';
    if (event === 'condition_matched') return EVENT_TRIGGER_TYPES.has(input.eventType);
    return event === input.eventType && SUPPORT_MARK_EVENTS.has(event);
  }
  if (!EVENT_TRIGGER_TYPES.has(candidate.trigger_type) || candidate.trigger_type !== input.eventType) {
    return false;
  }
  const config = parseObject(candidate.trigger_config, 'trigger_config');
  const allowed = EVENT_FILTER_KEYS[input.eventType];
  if (!allowed) return false;
  for (const [key, expected] of Object.entries(config)) {
    if (!allowed.has(key)) throw new Error(`trigger_config_unknown:${key}`);
    if (!equalFilter(input.eventData?.[key], expected)) return false;
  }
  return true;
}

async function friendBelongsToAccount(
  db: D1Database,
  friendId: string,
  lineAccountId: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS ok FROM friends WHERE id = ? AND line_account_id = ? LIMIT 1`,
  ).bind(friendId, lineAccountId).first<{ ok: number }>();
  return !!row;
}

function defaultExecutors(
  input: { lineAccessToken?: string },
  options: AutomationTriggerOptions,
): Record<string, AutomationActionExecutor> {
  if (options.executors) return options.executors;
  return createAutomationActionExecutors({
    credentialEncryptionKey: options.credentialEncryptionKey,
    ...(input.lineAccessToken
      ? { resolveLineAccessToken: async () => input.lineAccessToken! }
      : {}),
  });
}

async function startCandidate(
  db: D1Database,
  candidate: AutomationCandidate,
  input: AutomationEventInput,
  options: AutomationTriggerOptions,
): Promise<AutomationDispatchItem> {
  try {
    if (input.friendId && !(await friendBelongsToAccount(db, input.friendId, input.lineAccountId))) {
      throw new Error('friend_account_mismatch');
    }
    const condition = parseTargetCondition(candidate.condition_config);
    const conditionMatched = condition
      ? !!input.friendId && await matchesCondition(db, input.friendId, condition)
      : true;
    const started = await startAutomationRun(db, {
      lineAccountId: input.lineAccountId,
      automationId: candidate.automation_id,
      sourceEventId: input.sourceEventId,
      idempotencyKey: input.sourceEventId,
      friendId: input.friendId,
      inputEvent: { ...input.eventData, type: input.eventType },
      conditionMatched,
      now: options.now,
    });
    let status: AutomationDispatchItem['status'] = started.status;
    if (started.kind === 'created' && started.runId && started.status === 'queued') {
      status = await processAutomationRun(db, started.runId, {
        now: options.now,
        executors: defaultExecutors(input, options),
      });
    }
    return {
      automationId: candidate.automation_id,
      runId: started.runId,
      kind: started.kind,
      status,
    };
  } catch (error) {
    return {
      automationId: candidate.automation_id,
      runId: null,
      kind: 'configuration_error',
      status: 'configuration_error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function dispatchAutomationEvent(
  db: D1Database,
  input: AutomationEventInput,
  options: AutomationTriggerOptions = {},
): Promise<AutomationDispatchItem[]> {
  if (!input.lineAccountId || !input.sourceEventId || !EVENT_TRIGGER_TYPES.has(input.eventType)) return [];
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const [eventRows, supportRows] = await Promise.all([
    db.prepare(
    `SELECT d.id AS automation_id, d.priority, v.trigger_type, v.trigger_config, v.condition_config
       FROM automation_definitions d
       JOIN automation_versions v
         ON v.id = d.current_published_version_id
        AND v.automation_id = d.id AND v.status = 'published'
      WHERE d.line_account_id = ? AND d.status = 'active' AND v.trigger_type = ?
      ORDER BY d.priority DESC, d.created_at ASC
      LIMIT ?`,
    ).bind(input.lineAccountId, input.eventType, limit).all<AutomationCandidate>(),
    db.prepare(
      `SELECT d.id AS automation_id, d.priority, v.trigger_type, v.trigger_config, v.condition_config
         FROM automation_definitions d
         JOIN automation_versions v
           ON v.id = d.current_published_version_id
          AND v.automation_id = d.id AND v.status = 'published'
        WHERE d.line_account_id = ? AND d.status = 'active'
          AND v.trigger_type = 'support_mark_change'
        ORDER BY d.priority DESC, d.created_at ASC
        LIMIT ?`,
    ).bind(input.lineAccountId, limit).all<AutomationCandidate>(),
  ]);

  const results: AutomationDispatchItem[] = [];
  let supportMarkWinnerChosen = false;
  for (const candidate of [...(eventRows.results ?? []), ...(supportRows.results ?? [])]) {
    try {
      if (!matchesEventTrigger(candidate, input)) continue;
      if (candidate.trigger_type === SUPPORT_MARK_TRIGGER_TYPE) {
        if (supportMarkWinnerChosen || !input.friendId) continue;
        const condition = parseTargetCondition(candidate.condition_config);
        if (condition && !await matchesCondition(db, input.friendId, condition)) continue;
        supportMarkWinnerChosen = true;
      }
      results.push(await startCandidate(db, candidate, input, options));
    } catch (error) {
      results.push({
        automationId: candidate.automation_id,
        runId: null,
        kind: 'configuration_error',
        status: 'configuration_error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/** ルートや既存イベント経路から呼ぶ入口。設定エラーはPIIを含めず運用ログへ残す。 */
export async function dispatchAutomationEventWithLogging(
  db: D1Database,
  input: AutomationEventInput,
  options: AutomationTriggerOptions = {},
): Promise<AutomationDispatchItem[]> {
  const results = await dispatchAutomationEvent(db, input, options);
  for (const result of results) {
    if (result.kind === 'configuration_error') {
      console.error(JSON.stringify({
        event: 'automation_v6_trigger_failed',
        automationId: result.automationId,
        eventType: input.eventType,
        reason: result.error,
      }));
    }
  }
  return results;
}

interface ScheduleConfig {
  friendIds: string[];
  at?: string;
  time?: string;
  weekdays?: number[];
}

interface LocalParts {
  date: string;
  hour: number;
  minute: number;
  weekday: number;
}

function parseScheduleConfig(raw: string, triggerType: string): ScheduleConfig {
  const value = parseObject(raw, 'trigger_config');
  const allowed = triggerType === 'datetime'
    ? new Set(['friendIds', 'at'])
    : triggerType === 'daily'
      ? new Set(['friendIds', 'time'])
      : new Set(['friendIds', 'time', 'weekdays']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`trigger_config_unknown:${key}`);
  }
  const friendIds = value.friendIds;
  if (
    !Array.isArray(friendIds)
    || friendIds.length === 0
    || friendIds.length > 100
    || friendIds.some((id) => typeof id !== 'string' || !id)
  ) throw new Error('trigger_config_friend_ids_invalid');
  const config: ScheduleConfig = { friendIds: [...new Set(friendIds as string[])] };
  if (triggerType === 'datetime') {
    if (
      typeof value.at !== 'string'
      || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.at)
      || !Number.isFinite(Date.parse(value.at))
    ) {
      throw new Error('trigger_config_at_invalid');
    }
    config.at = value.at;
  } else {
    if (
      typeof value.time !== 'string'
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)
      || Number(value.time.slice(3, 5)) % 5 !== 0
    ) {
      throw new Error('trigger_config_time_invalid');
    }
    config.time = value.time;
    if (triggerType === 'weekly') {
      if (
        !Array.isArray(value.weekdays)
        || value.weekdays.length === 0
        || value.weekdays.some((day) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6)
      ) throw new Error('trigger_config_weekdays_invalid');
      config.weekdays = [...new Set(value.weekdays as number[])];
    }
  }
  return config;
}

function localParts(now: Date, timeZone: string): LocalParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(now);
  } catch {
    throw new Error('account_timezone_invalid');
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const weekdays: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: weekdays[get('weekday')] ?? -1,
  };
}

function dueOccurrence(
  triggerType: string,
  config: ScheduleConfig,
  now: Date,
  timeZone: string,
): string | null {
  if (triggerType === 'datetime') {
    const at = new Date(config.at!).getTime();
    const current = now.getTime();
    return current >= at && current < at + 5 * 60_000 ? new Date(at).toISOString() : null;
  }
  const local = localParts(now, timeZone);
  if (triggerType === 'weekly' && !config.weekdays!.includes(local.weekday)) return null;
  const [hour, minute] = config.time!.split(':').map(Number);
  const scheduledMinute = hour * 60 + minute;
  const currentMinute = local.hour * 60 + local.minute;
  if (currentMinute < scheduledMinute || currentMinute >= scheduledMinute + 5) return null;
  return `${local.date}T${config.time}:00[${timeZone}]`;
}

export async function processScheduledAutomationTriggers(
  db: D1Database,
  options: AutomationTriggerOptions = {},
): Promise<{ due: number; results: AutomationDispatchItem[] }> {
  const now = new Date(options.now ?? new Date().toISOString());
  if (Number.isNaN(now.getTime())) throw new Error('scheduled_now_invalid');
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const candidates = await db.prepare(
    `SELECT d.id AS automation_id, d.priority, d.line_account_id, v.trigger_type, v.trigger_config, v.condition_config,
            a.timezone
       FROM automation_definitions d
       JOIN automation_versions v
         ON v.id = d.current_published_version_id
        AND v.automation_id = d.id AND v.status = 'published'
       JOIN line_accounts a ON a.id = d.line_account_id AND a.is_active = 1
      WHERE d.status = 'active' AND v.trigger_type IN ('datetime', 'daily', 'weekly')
      ORDER BY d.priority DESC, d.created_at ASC
      LIMIT ?`,
  ).bind(limit).all<ScheduledCandidate>();

  const results: AutomationDispatchItem[] = [];
  let due = 0;
  for (const candidate of candidates.results ?? []) {
    if (!SCHEDULE_TRIGGER_TYPES.has(candidate.trigger_type)) continue;
    try {
      const config = parseScheduleConfig(candidate.trigger_config, candidate.trigger_type);
      const occurrence = dueOccurrence(candidate.trigger_type, config, now, candidate.timezone);
      if (!occurrence) continue;
      due += 1;
      if (results.length + config.friendIds.length > limit) {
        results.push({
          automationId: candidate.automation_id,
          runId: null,
          kind: 'configuration_error',
          status: 'configuration_error',
          error: 'scheduled_trigger_capacity_exceeded',
        });
        continue;
      }
      for (const friendId of config.friendIds) {
        results.push(await startCandidate(db, candidate, {
          lineAccountId: candidate.line_account_id,
          eventType: candidate.trigger_type,
          sourceEventId: `schedule:${candidate.automation_id}:${occurrence}:${friendId}`,
          friendId,
          eventData: { occurrence, timeZone: candidate.timezone },
        }, { ...options, now: now.toISOString() }));
      }
    } catch (error) {
      results.push({
        automationId: candidate.automation_id,
        runId: null,
        kind: 'configuration_error',
        status: 'configuration_error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { due, results };
}

/** 返信期限を過ぎた会話を、期限そのものを冪等キーにして一度だけ評価する。 */
export async function processOverdueSupportMarkTriggers(
  db: D1Database,
  options: AutomationTriggerOptions = {},
): Promise<AutomationDispatchItem[]> {
  const now = options.now ?? new Date().toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const rows = await db.prepare(
    `SELECT c.id AS chat_id, c.friend_id, c.line_account_id, c.next_response_due_at
       FROM chats c
      WHERE c.next_response_due_at IS NOT NULL
        AND datetime(c.next_response_due_at) <= datetime(?)
        AND c.status != 'resolved'
        AND c.line_account_id IS NOT NULL
      ORDER BY c.next_response_due_at ASC, c.id ASC
      LIMIT ?`,
  ).bind(now, limit).all<{
    chat_id: string;
    friend_id: string;
    line_account_id: string;
    next_response_due_at: string;
  }>();
  const results: AutomationDispatchItem[] = [];
  for (const row of rows.results ?? []) {
    results.push(...await dispatchAutomationEvent(db, {
      lineAccountId: row.line_account_id,
      eventType: 'response_overdue',
      sourceEventId: `response-overdue:${row.chat_id}:${row.next_response_due_at}`,
      friendId: row.friend_id,
      eventData: { dueAt: row.next_response_due_at },
    }, { ...options, now }));
  }
  return results;
}
