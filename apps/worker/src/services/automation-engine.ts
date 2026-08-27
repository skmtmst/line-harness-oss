/**
 * V6オートメーションの実行状態機械。
 *
 * 旧 automations.actions は読まない。実行開始時に公開版と共通アクション版を
 * 固定し、外部処理は注入された executor に同じ stepExecutionId を渡す。
 */

import { isOperationCapabilityStopped } from '@line-crm/db';

const DEFAULT_LEASE_MINUTES = 5;
const RETRY_DELAYS_MINUTES = [1, 5, 30] as const;
const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'success'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'skipped_condition';

type StepStatus = 'queued' | 'running' | 'waiting' | 'success' | 'failed' | 'skipped' | 'cancelled';
type FailureMode = 'stop' | 'continue';

export interface ActionDefinition {
  id: string;
  type: string;
  params: Record<string, unknown>;
  onFailure: FailureMode;
  /** 実行開始時に固定した共通アクション版。実行計画だけが持つ。 */
  commonActionVersionId?: string | null;
}

interface RunRow {
  id: string;
  line_account_id: string;
  automation_id: string;
  automation_version_id: string;
  friend_id: string | null;
  source_event_id: string;
  idempotency_key: string;
  status: RunStatus;
  current_step: number;
  input_event_json: string;
  is_test: number;
  action_config: string;
  execution_plan_json: string | null;
}

interface StepRow {
  id: string;
  automation_run_id: string;
  step_key: string;
  action_type: string;
  common_action_version_id: string | null;
  attempt_number: number;
  idempotency_key: string;
  status: StepStatus;
  retry_at: string | null;
  lease_expires_at: string | null;
}

export interface AutomationRunStartInput {
  lineAccountId: string;
  automationId: string;
  sourceEventId: string;
  idempotencyKey: string;
  friendId?: string | null;
  inputEvent?: Record<string, unknown>;
  conditionMatched: boolean;
  isTest?: boolean;
  now?: string;
}

export interface AutomationRunStartResult {
  kind: 'created' | 'existing' | 'not_active';
  runId: string | null;
  status: RunStatus | null;
  automationVersionId: string | null;
}

export interface AutomationActionContext {
  db: D1Database;
  runId: string;
  lineAccountId: string;
  automationId: string;
  automationVersionId: string;
  friendId: string | null;
  sourceEventId: string;
  inputEvent: Record<string, unknown>;
  action: ActionDefinition;
  stepExecutionId: string;
  idempotencyKey: string;
  attemptNumber: number;
  commonActionVersionId: string | null;
  isTest: boolean;
}

export type AutomationActionExecutor = (
  context: AutomationActionContext,
) => Promise<{ output?: unknown } | void>;

export interface AutomationEngineOptions {
  executors?: Record<string, AutomationActionExecutor>;
  now?: string;
  leaseMinutes?: number;
}

export class AutomationActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AutomationActionError';
  }
}

function addMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function nowIso(value?: string): string {
  return value ?? new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new AutomationActionError('invalid_input_event', '実行入力が不正です', false);
  return value;
}

function parseActions(text: string): ActionDefinition[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AutomationActionError('invalid_action_config_json', '処理定義のJSONが不正です', false);
  }
  if (!Array.isArray(value)) {
    throw new AutomationActionError('invalid_action_config', '処理定義は配列である必要があります', false);
  }

  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new AutomationActionError('invalid_action_shape', `${index + 1}番目の処理定義が不正です`, false);
    }
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const type = typeof item.type === 'string' ? item.type.trim() : '';
    const params = item.params;
    const onFailure = item.onFailure ?? 'stop';
    if (!id || !type || !isRecord(params) || (onFailure !== 'stop' && onFailure !== 'continue')) {
      throw new AutomationActionError('invalid_action_shape', `${index + 1}番目の処理定義が不正です`, false);
    }
    if (ids.has(id)) {
      throw new AutomationActionError('duplicate_action_id', `処理ID ${id} が重複しています`, false);
    }
    ids.add(id);
    const commonActionVersionId = typeof item.commonActionVersionId === 'string'
      ? item.commonActionVersionId.trim() || null
      : null;
    return { id, type, params, onFailure, commonActionVersionId };
  });
}

async function getRun(db: D1Database, runId: string): Promise<RunRow | null> {
  return db.prepare(
    `SELECT r.id, r.line_account_id, r.automation_id, r.automation_version_id,
            r.friend_id, r.source_event_id, r.idempotency_key, r.status,
            r.current_step, r.input_event_json, r.is_test, v.action_config,
            r.execution_plan_json
       FROM automation_runs r
       JOIN automation_versions v
         ON v.id = r.automation_version_id AND v.automation_id = r.automation_id
      WHERE r.id = ?`,
  ).bind(runId).first<RunRow>();
}

async function getStep(db: D1Database, runId: string, stepKey: string): Promise<StepRow | null> {
  return db.prepare(
    `SELECT id, automation_run_id, step_key, action_type, common_action_version_id,
            attempt_number, idempotency_key, status, retry_at, lease_expires_at
       FROM automation_run_steps
      WHERE automation_run_id = ? AND step_key = ?`,
  ).bind(runId, stepKey).first<StepRow>();
}

async function resolveCommonActionVersion(
  db: D1Database,
  input: { lineAccountId: string; automationId: string; action: ActionDefinition },
): Promise<string | null> {
  if (input.action.type !== 'common_action') return null;
  const commonActionId = input.action.params.commonActionId;
  if (typeof commonActionId !== 'string' || !commonActionId.trim()) return null;

  const explicitVersionId = input.action.params.commonActionVersionId;
  if (typeof explicitVersionId === 'string' && explicitVersionId.trim()) {
    const explicit = await db.prepare(
      `SELECT cav.id
         FROM common_action_versions cav
         JOIN common_actions ca ON ca.id = cav.common_action_id
        WHERE cav.id = ? AND cav.common_action_id = ? AND cav.status = 'published'
          AND ca.line_account_id = ?`,
    ).bind(explicitVersionId, commonActionId, input.lineAccountId).first<{ id: string }>();
    return explicit?.id ?? null;
  }

  const binding = await db.prepare(
    `SELECT b.common_action_version_id AS id
       FROM common_action_bindings b
       JOIN common_action_versions cav
         ON cav.id = b.common_action_version_id AND cav.common_action_id = b.common_action_id
      WHERE b.line_account_id = ? AND b.consumer_type = 'automation'
        AND b.consumer_id = ? AND b.consumer_path = ? AND b.common_action_id = ?
        AND cav.status = 'published'
      LIMIT 1`,
  ).bind(input.lineAccountId, input.automationId, input.action.id, commonActionId)
    .first<{ id: string }>();
  return binding?.id ?? null;
}

async function buildExecutionPlan(
  db: D1Database,
  input: {
    lineAccountId: string;
    automationId: string;
    actions: ActionDefinition[];
    prefix?: string;
    depth?: number;
    budget?: { count: number };
  },
): Promise<ActionDefinition[]> {
  const depth = input.depth ?? 0;
  const budget = input.budget ?? { count: 0 };
  if (depth > 20) {
    throw new AutomationActionError('common_action_too_deep', '共通アクションの呼び出しが深すぎます', false);
  }
  const plan: ActionDefinition[] = [];
  for (const action of input.actions) {
    budget.count += 1;
    if (budget.count > 1_000) {
      throw new AutomationActionError('execution_plan_too_large', '実行する処理が多すぎます', false);
    }
    const stepKey = input.prefix ? `${input.prefix}/${action.id}` : action.id;
    if (action.type !== 'common_action') {
      const params = action.type === 'wait' && action.params.durationMinutes === undefined
        ? { ...action.params, durationMinutes: action.params.minutes }
        : action.params;
      plan.push({ ...action, id: stepKey, params });
      continue;
    }

    const commonActionVersionId = await resolveCommonActionVersion(db, {
      lineAccountId: input.lineAccountId,
      automationId: input.automationId,
      action,
    });
    if (!commonActionVersionId) {
      throw new AutomationActionError(
        'common_action_version_not_pinned',
        '公開済みの共通アクション版を固定できませんでした',
        false,
      );
    }
    const version = await db.prepare(
      `SELECT cav.action_config
         FROM common_action_versions cav
         JOIN common_actions ca ON ca.id = cav.common_action_id
        WHERE cav.id = ? AND cav.status = 'published' AND ca.line_account_id = ?`,
    ).bind(commonActionVersionId, input.lineAccountId).first<{ action_config: string }>();
    if (!version) {
      throw new AutomationActionError('common_action_version_not_found', '固定した共通アクション版が見つかりません', false);
    }

    // 利用版を実行履歴に1行残し、その後ろへ実際の処理を展開する。
    plan.push({
      id: stepKey,
      type: 'common_action_marker',
      params: { commonActionId: action.params.commonActionId },
      onFailure: action.onFailure,
      commonActionVersionId,
    });
    plan.push(...await buildExecutionPlan(db, {
      lineAccountId: input.lineAccountId,
      automationId: input.automationId,
      actions: parseActions(version.action_config),
      prefix: stepKey,
      depth: depth + 1,
      budget,
    }));
  }
  return plan;
}

async function precreateSteps(db: D1Database, run: RunRow, actions: ActionDefinition[]): Promise<void> {
  for (const action of actions) {
    const stepId = crypto.randomUUID();
    const commonActionVersionId = action.commonActionVersionId ?? await resolveCommonActionVersion(db, {
      lineAccountId: run.line_account_id,
      automationId: run.automation_id,
      action,
    });
    await db.prepare(
      `INSERT OR IGNORE INTO automation_run_steps
         (id, automation_run_id, step_key, action_type, common_action_version_id,
          attempt_number, idempotency_key, status, input_json)
       VALUES (?, ?, ?, ?, ?, 1, ?, 'queued', ?)`,
    ).bind(
      stepId,
      run.id,
      action.id,
      action.type,
      commonActionVersionId,
      stepId,
      JSON.stringify(action.params),
    ).run();
  }
}

export async function startAutomationRun(
  db: D1Database,
  input: AutomationRunStartInput,
): Promise<AutomationRunStartResult> {
  const now = nowIso(input.now);
  const published = await db.prepare(
    `SELECT d.id AS automation_id, d.current_published_version_id AS version_id,
            v.action_config
       FROM automation_definitions d
       JOIN automation_versions v
         ON v.id = d.current_published_version_id AND v.automation_id = d.id
        AND v.status = 'published'
      WHERE d.id = ? AND d.line_account_id = ? AND d.status = 'active'`,
  ).bind(input.automationId, input.lineAccountId).first<{
    automation_id: string;
    version_id: string;
    action_config: string;
  }>();
  if (!published) {
    return { kind: 'not_active', runId: null, status: null, automationVersionId: null };
  }

  const runId = crypto.randomUUID();
  const status: RunStatus = input.conditionMatched ? 'queued' : 'skipped_condition';
  let executionPlan: ActionDefinition[] = [];
  if (status === 'queued') {
    try {
      executionPlan = await buildExecutionPlan(db, {
        lineAccountId: input.lineAccountId,
        automationId: input.automationId,
        actions: parseActions(published.action_config),
      });
    } catch (error) {
      const failure = normalizeError(error);
      executionPlan = [{
        id: '__configuration__', type: 'invalid_configuration', params: {
          errorCode: failure.code, errorMessage: failure.message,
        }, onFailure: 'stop',
      }];
    }
  }
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO automation_runs
       (id, line_account_id, automation_id, automation_version_id, friend_id,
        source_event_id, idempotency_key, status, input_event_json, is_test,
        completed_at, created_at, execution_plan_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    runId,
    input.lineAccountId,
    input.automationId,
    published.version_id,
    input.friendId ?? null,
    input.sourceEventId,
    input.idempotencyKey,
    status,
    JSON.stringify(input.inputEvent ?? {}),
    input.isTest ? 1 : 0,
    status === 'skipped_condition' ? now : null,
    now,
    status === 'queued' ? JSON.stringify(executionPlan) : null,
  ).run();

  if ((inserted.meta?.changes ?? 0) !== 1) {
    const existing = await db.prepare(
      `SELECT id, status, automation_version_id
         FROM automation_runs
        WHERE line_account_id = ? AND automation_id = ? AND idempotency_key = ?`,
    ).bind(input.lineAccountId, input.automationId, input.idempotencyKey).first<{
      id: string;
      status: RunStatus;
      automation_version_id: string;
    }>();
    if (!existing) throw new Error('automation_run_idempotency_lookup_failed');
    return {
      kind: 'existing',
      runId: existing.id,
      status: existing.status,
      automationVersionId: existing.automation_version_id,
    };
  }

  if (status === 'queued') {
    const run = await getRun(db, runId);
    if (!run) throw new Error('automation_run_insert_failed');
    try {
      if (executionPlan[0]?.type === 'invalid_configuration') {
        const errorCode = String(executionPlan[0].params.errorCode ?? 'invalid_configuration');
        const errorMessage = String(executionPlan[0].params.errorMessage ?? '実行計画を作れませんでした');
        await failConfiguration(db, runId, now, errorCode, errorMessage);
        return { kind: 'created', runId, status: 'failed', automationVersionId: published.version_id };
      }
      await precreateSteps(db, run, executionPlan);
    } catch (error) {
      const failure = normalizeError(error);
      await failConfiguration(db, runId, now, failure.code, failure.message);
      return { kind: 'created', runId, status: 'failed', automationVersionId: published.version_id };
    }
  }

  return { kind: 'created', runId, status, automationVersionId: published.version_id };
}

async function setRunFailed(db: D1Database, runId: string, now: string): Promise<void> {
  await db.prepare(
    `UPDATE automation_runs
        SET status = 'failed', completed_at = ?, resume_at = NULL, lease_expires_at = NULL
      WHERE id = ? AND status NOT IN ('success', 'partial', 'failed', 'cancelled', 'skipped_condition')`,
  ).bind(now, runId).run();
}

async function failConfiguration(
  db: D1Database,
  runId: string,
  now: string,
  code: string,
  message: string,
): Promise<void> {
  await setRunFailed(db, runId, now);
  // 処理定義そのものが読めない場合にも、原因を追える1行を残す。
  const stepId = crypto.randomUUID();
  await db.prepare(
    `INSERT OR IGNORE INTO automation_run_steps
       (id, automation_run_id, step_key, action_type, idempotency_key, status,
        input_json, error_code, error_message, completed_at)
     VALUES (?, ?, '__configuration__', 'invalid_configuration', ?, 'failed', '{}', ?, ?, ?)`,
  ).bind(stepId, runId, stepId, code, message, now).run();
}

async function claimRun(
  db: D1Database,
  runId: string,
  now: string,
  leaseMinutes: number,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE automation_runs
        SET status = 'running', started_at = COALESCE(started_at, ?), resume_at = NULL,
            lease_expires_at = ?
      WHERE id = ? AND (
        status = 'queued'
        OR (status = 'waiting' AND resume_at <= ?)
        OR (status = 'running' AND lease_expires_at <= ?)
      )`,
  ).bind(now, addMinutes(now, leaseMinutes), runId, now, now).run();
  return (result.meta?.changes ?? 0) === 1;
}

async function claimStep(
  db: D1Database,
  step: StepRow,
  now: string,
  leaseMinutes: number,
): Promise<StepRow | null> {
  if (step.status === 'running' && step.attempt_number >= MAX_ATTEMPTS) return null;
  const result = await db.prepare(
    `UPDATE automation_run_steps
        SET status = 'running',
            attempt_number = CASE WHEN status = 'queued' THEN attempt_number ELSE attempt_number + 1 END,
            started_at = COALESCE(started_at, ?), retry_at = NULL, lease_expires_at = ?
      WHERE id = ? AND (
        status = 'queued'
        OR (status = 'waiting' AND retry_at <= ?)
        OR (status = 'running' AND lease_expires_at <= ?)
      )`,
  ).bind(now, addMinutes(now, leaseMinutes), step.id, now, now).run();
  if ((result.meta?.changes ?? 0) !== 1) return null;
  return getStep(db, step.automation_run_id, step.step_key);
}

function normalizeError(error: unknown): AutomationActionError {
  if (error instanceof AutomationActionError) return error;
  if (error instanceof Error) return new AutomationActionError('action_failed', error.message, true);
  return new AutomationActionError('action_failed', '処理に失敗しました', true);
}

async function markStepFailure(
  db: D1Database,
  step: StepRow,
  error: AutomationActionError,
  now: string,
): Promise<'retry' | 'failed'> {
  if (error.retryable && step.attempt_number < MAX_ATTEMPTS) {
    const retryAt = addMinutes(now, RETRY_DELAYS_MINUTES[step.attempt_number - 1]);
    await db.prepare(
      `UPDATE automation_run_steps
          SET status = 'waiting', error_code = ?, error_message = ?, retry_at = ?,
              lease_expires_at = NULL
        WHERE id = ? AND status = 'running'`,
    ).bind(error.code, error.message, retryAt, step.id).run();
    await db.prepare(
      `UPDATE automation_runs
          SET status = 'waiting', resume_at = ?, lease_expires_at = NULL
        WHERE id = ? AND status = 'running'`,
    ).bind(retryAt, step.automation_run_id).run();
    return 'retry';
  }
  await db.prepare(
    `UPDATE automation_run_steps
        SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?,
            retry_at = NULL, lease_expires_at = NULL
      WHERE id = ?`,
  ).bind(error.code, error.message, now, step.id).run();
  return 'failed';
}

async function finishRun(db: D1Database, runId: string, now: string): Promise<RunStatus> {
  const counts = await db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
       SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count
       FROM automation_run_steps
      WHERE automation_run_id = ? AND step_key != '__configuration__'`,
  ).bind(runId).first<{ failed_count: number | null; success_count: number | null }>();
  const failed = Number(counts?.failed_count ?? 0);
  const succeeded = Number(counts?.success_count ?? 0);
  const status: RunStatus = failed === 0 ? 'success' : succeeded > 0 ? 'partial' : 'failed';
  await db.prepare(
    `UPDATE automation_runs
        SET status = ?, completed_at = ?, resume_at = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'running'`,
  ).bind(status, now, runId).run();
  return status;
}

async function scheduleWait(
  db: D1Database,
  run: RunRow,
  step: StepRow,
  action: ActionDefinition,
  now: string,
): Promise<void> {
  const durationMinutes = action.params.durationMinutes;
  if (
    typeof durationMinutes !== 'number'
    || !Number.isInteger(durationMinutes)
    || durationMinutes <= 0
    || durationMinutes % 5 !== 0
  ) {
    throw new AutomationActionError('invalid_wait_duration', '待機時間は5分単位で指定してください', false);
  }
  const resumeAt = addMinutes(now, durationMinutes);
  await db.prepare(
    `UPDATE automation_run_steps
        SET status = 'waiting', output_json = ?, retry_at = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'running'`,
  ).bind(JSON.stringify({ resumeAt }), step.id).run();
  await db.prepare(
    `UPDATE automation_runs
        SET status = 'waiting', resume_at = ?, lease_expires_at = NULL
      WHERE id = ? AND status = 'running'`,
  ).bind(resumeAt, run.id).run();
}

export async function processAutomationRun(
  db: D1Database,
  runId: string,
  options: AutomationEngineOptions = {},
): Promise<RunStatus | 'busy' | 'not_found'> {
  const now = nowIso(options.now);
  const leaseMinutes = options.leaseMinutes ?? DEFAULT_LEASE_MINUTES;
  const beforeClaim = await getRun(db, runId);
  if (!beforeClaim) return 'not_found';
  if (await isOperationCapabilityStopped(db, beforeClaim.line_account_id, 'automation_actions')) {
    // 実行をclaimせず、停止解除後も同じ版・同じstepから再確認できる状態に置く。
    return beforeClaim.status;
  }
  if (!(await claimRun(db, runId, now, leaseMinutes))) {
    const existing = await getRun(db, runId);
    if (!existing) return 'not_found';
    if (['success', 'partial', 'failed', 'cancelled', 'skipped_condition'].includes(existing.status)) {
      return existing.status;
    }
    return 'busy';
  }

  const run = await getRun(db, runId);
  if (!run) return 'not_found';
  let actions: ActionDefinition[];
  let inputEvent: Record<string, unknown>;
  try {
    actions = parseActions(run.execution_plan_json ?? run.action_config);
    inputEvent = parseObject(run.input_event_json);
  } catch (error) {
    const failure = normalizeError(error);
    await failConfiguration(db, run.id, now, failure.code, failure.message);
    return 'failed';
  }

  for (let index = run.current_step; index < actions.length; index += 1) {
    const action = actions[index];
    let step = await getStep(db, run.id, action.id);
    if (!step) {
      await precreateSteps(db, run, [action]);
      step = await getStep(db, run.id, action.id);
    }
    if (!step) {
      await failConfiguration(db, run.id, now, 'step_create_failed', '処理結果の記録を作れませんでした');
      return 'failed';
    }

    if (step.status === 'success' || step.status === 'skipped') {
      await db.prepare(`UPDATE automation_runs SET current_step = ? WHERE id = ?`)
        .bind(index + 1, run.id).run();
      continue;
    }

    if (action.type === 'wait' && step.status === 'waiting') {
      await db.prepare(
        `UPDATE automation_run_steps
            SET status = 'success', completed_at = ?, lease_expires_at = NULL
          WHERE id = ? AND status = 'waiting'`,
      ).bind(now, step.id).run();
      await db.prepare(`UPDATE automation_runs SET current_step = ? WHERE id = ?`)
        .bind(index + 1, run.id).run();
      continue;
    }

    const claimed = await claimStep(db, step, now, leaseMinutes);
    if (!claimed) {
      if (step.status === 'running' && step.attempt_number >= MAX_ATTEMPTS) {
        const failure = new AutomationActionError(
          'action_lease_expired',
          '処理結果が確定しないまま再試行上限に達しました',
          false,
        );
        await markStepFailure(db, step, failure, now);
        if (action.onFailure === 'stop') {
          await setRunFailed(db, run.id, now);
          return 'failed';
        }
        await db.prepare(`UPDATE automation_runs SET current_step = ? WHERE id = ?`)
          .bind(index + 1, run.id).run();
        continue;
      }
      return 'busy';
    }
    step = claimed;

    try {
      if (action.type === 'wait') {
        await scheduleWait(db, run, step, action, now);
        return 'waiting';
      }
      if (action.type === 'common_action_marker') {
        await db.prepare(
          `UPDATE automation_run_steps
              SET status = 'success', output_json = ?, completed_at = ?,
                  retry_at = NULL, lease_expires_at = NULL
            WHERE id = ? AND status = 'running'`,
        ).bind(JSON.stringify({ versionId: step.common_action_version_id }), now, step.id).run();
        await db.prepare(`UPDATE automation_runs SET current_step = ? WHERE id = ?`)
          .bind(index + 1, run.id).run();
        continue;
      }
      if (action.type === 'common_action' && !step.common_action_version_id) {
        throw new AutomationActionError(
          'common_action_version_not_pinned',
          '公開済みの共通アクション版が固定されていません',
          false,
        );
      }
      const executor = options.executors?.[action.type];
      if (!executor) {
        throw new AutomationActionError(
          'unsupported_action_type',
          `処理 ${action.type} は実行エンジンに接続されていません`,
          false,
        );
      }
      const result = await executor({
        db,
        runId: run.id,
        lineAccountId: run.line_account_id,
        automationId: run.automation_id,
        automationVersionId: run.automation_version_id,
        friendId: run.friend_id,
        sourceEventId: run.source_event_id,
        inputEvent,
        action,
        stepExecutionId: step.id,
        idempotencyKey: step.id,
        attemptNumber: step.attempt_number,
        commonActionVersionId: step.common_action_version_id,
        isTest: run.is_test === 1,
      });
      await db.prepare(
        `UPDATE automation_run_steps
            SET status = 'success', output_json = ?, error_code = NULL, error_message = NULL,
                completed_at = ?, retry_at = NULL, lease_expires_at = NULL
          WHERE id = ? AND status = 'running'`,
      ).bind(JSON.stringify(result?.output ?? null), now, step.id).run();
      await db.prepare(`UPDATE automation_runs SET current_step = ? WHERE id = ?`)
        .bind(index + 1, run.id).run();
    } catch (error) {
      const failure = normalizeError(error);
      const outcome = await markStepFailure(db, step, failure, now);
      if (outcome === 'retry') return 'waiting';
      if (action.onFailure === 'stop') {
        await setRunFailed(db, run.id, now);
        return 'failed';
      }
      await db.prepare(`UPDATE automation_runs SET current_step = ? WHERE id = ?`)
        .bind(index + 1, run.id).run();
    }
  }

  return finishRun(db, run.id, now);
}

export async function processDueAutomationRuns(
  db: D1Database,
  options: AutomationEngineOptions & { limit?: number } = {},
): Promise<{ processed: number; results: Array<{ runId: string; status: string }> }> {
  const now = nowIso(options.now);
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const due = await db.prepare(
    `SELECT id FROM automation_runs
      WHERE status = 'queued'
         OR (status = 'waiting' AND resume_at <= ?)
         OR (status = 'running' AND lease_expires_at <= ?)
      ORDER BY created_at ASC
      LIMIT ?`,
  ).bind(now, now, limit).all<{ id: string }>();
  const results: Array<{ runId: string; status: string }> = [];
  for (const row of due.results ?? []) {
    const status = await processAutomationRun(db, row.id, { ...options, now });
    results.push({ runId: row.id, status });
  }
  return { processed: results.length, results };
}
