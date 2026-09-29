import {
  recordIncomingWebhookUnmatched,
  type IncomingWebhookActionRef,
  type IncomingWebhookIdentityMatch,
} from '@line-crm/db';
import type { ActionDefinition, AutomationActionContext } from './automation-engine.js';
import { stableWebhookStepId, type IncomingWebhookExecution } from './incoming-webhook-receipts.js';
import {
  createAutomationActionExecutors,
  type AutomationActionExecutorDependencies,
} from './automation-action-executors.js';

type ActionRunResult = {
  matchedFriendId: string | null;
  executed: number;
  failed: number;
  /** S: matched / not_found / ambiguous(複数一致で保留)のどれだったか。 */
  matchStatus: 'matched' | 'not_found' | 'ambiguous' | 'skipped';
};

/**
 * S (#939 機能26): 人の照合結果。0件は not_found、1件は matched、
 * 2件以上は ambiguous。ambiguous は行動を自動実行せず箱へ保留し、
 * 人がどの友だちか選ぶ(成り済ましの取り違えを防ぐ)。
 */
export type IncomingFriendMatch =
  | { status: 'matched'; friendId: string }
  | { status: 'ambiguous'; friendIds: string[] }
  | { status: 'not_found' };

function jsonPathSegment(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

/**
 * 届いた本文の「形」だけの見本。値はすべて •••• に伏せる。
 * 受け取り口の詳細画面の最新見本と、未照合の届物(#939 N-367)の両方で使う。
 */
export function maskedPayloadShape(payload: unknown) {
  const fields: Array<{ path: string; type: string; maskedValue: '••••' }> = [];
  let truncated = false;
  const visit = (value: unknown, path: string, depth: number) => {
    if (fields.length >= 50) {
      truncated = true;
      return;
    }
    if (depth >= 6 || value === null || typeof value !== 'object') {
      const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      fields.push({ path, type, maskedValue: '••••' });
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) fields.push({ path, type: 'array', maskedValue: '••••' });
      else visit(value[0], `${path}[0]`, depth + 1);
      return;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) fields.push({ path, type: 'object', maskedValue: '••••' });
    for (const [key, child] of entries) visit(child, `${path}${jsonPathSegment(key)}`, depth + 1);
  };
  visit(payload, '$', 0);
  return { fields, truncated };
}

function valueAtPath(payload: unknown, path: string): unknown {
  if (path === '$') return payload;
  const segments = path.slice(1).match(/\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\]/g) ?? [];
  let value = payload;
  for (const segment of segments) {
    if (value === null || typeof value !== 'object') return undefined;
    const key = segment.startsWith('.') ? segment.slice(1) : Number(segment.slice(1, -1));
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}

/** メールアドレスの照合用正規化。大文字小文字と前後の空白だけ揃える。 */
function normalizeEmailForMatch(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 電話番号の照合用正規化。数字だけにし、+81 / 81 始まりは国内表記
 * （0 始まり）へ揃える。どちら側も同じ関数を通すので表記揺れで外れない。
 */
function normalizePhoneForMatch(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('81') && digits.length >= 12) return `0${digits.slice(2)}`;
  return digits;
}

/** user_profile_values.value_json の中身を文字列へ戻す。壊れた行は null。 */
function profileValueText(valueJson: string): string | null {
  try {
    const parsed: unknown = JSON.parse(valueJson);
    if (typeof parsed === 'string') return parsed;
    if (typeof parsed === 'number') return String(parsed);
    return null;
  } catch {
    return null;
  }
}

export async function resolveFriendMatch(
  db: D1Database,
  lineAccountId: string,
  payload: unknown,
  config: IncomingWebhookIdentityMatch,
): Promise<IncomingFriendMatch> {
  /*
   * S (#939 機能26): 照合の決まり。
   * - 順に試し、最初に1件以上見つかった方法で決める(推奨順位どおり)
   * - 1件なら matched、2件以上なら ambiguous(先頭だけ選んで動かさない)
   * - 全部0件なら not_found。名前だけの照合は行わない。
   */
  for (const method of config.methods) {
    const raw = valueAtPath(payload, method.path);
    const value = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
    if (!value) continue;
    if (method.kind === 'harness_friend_id') {
      const row = await db.prepare(
        `SELECT id FROM friends WHERE id = ? AND line_account_id = ?`,
      ).bind(value, lineAccountId).first<{ id: string }>();
      if (row) return { status: 'matched', friendId: row.id };
      continue;
    }
    if (method.kind === 'verified_email' || method.kind === 'verified_phone') {
      // N-377: users.email / users.phone の値だけでは「検証済み」の裏付けに
      // ならない。検証済みと名乗る照合は、統合ユーザー機能で運用者が
      // 「確認済み」と印を付けた採用値（user_profile_values.verified_at が
      // ある行）にだけ一致させる。裏付けが無い行は一致させず、未照合の
      // 届物として箱へ送る（黙って結び付けない）。
      const fieldKey = method.kind === 'verified_email' ? 'email' : 'phone';
      const normalize = method.kind === 'verified_email' ? normalizeEmailForMatch : normalizePhoneForMatch;
      const want = normalize(value);
      if (!want) continue;
      const candidates = await db.prepare(
        `SELECT f.id AS friend_id, pv.value_json AS value_json
           FROM friends f
           JOIN user_profile_values pv ON pv.user_id = f.user_id
          WHERE f.line_account_id = ?
            AND pv.field_key = ? AND pv.is_active = 1 AND pv.verified_at IS NOT NULL
          ORDER BY f.created_at ASC`,
      ).bind(lineAccountId, fieldKey).all<{ friend_id: string; value_json: string }>();
      const matched: string[] = [];
      for (const row of candidates.results ?? []) {
        const stored = profileValueText(row.value_json);
        if (stored !== null && normalize(stored) === want && !matched.includes(row.friend_id)) {
          matched.push(row.friend_id);
        }
      }
      if (matched.length > 1) return { status: 'ambiguous', friendIds: matched };
      if (matched.length === 1) return { status: 'matched', friendId: matched[0]! };
      continue;
    }
    const rows = await db.prepare(
      `SELECT f.id, f.created_at
         FROM friends f
         JOIN users u ON u.id = f.user_id
        WHERE f.line_account_id = ? AND u.external_id = ?
        ORDER BY f.created_at ASC`,
    ).bind(lineAccountId, value).all<{ id: string }>();
    const ids: string[] = [];
    for (const row of rows.results ?? []) {
      if (!ids.includes(row.id)) ids.push(row.id);
    }
    if (ids.length > 1) return { status: 'ambiguous', friendIds: ids };
    if (ids.length === 1) return { status: 'matched', friendId: ids[0]! };
  }
  return { status: 'not_found' };
}

function directAction(ref: IncomingWebhookActionRef, index: number): ActionDefinition | null {
  const base = { id: `incoming-${index + 1}`, onFailure: 'continue' as const };
  switch (ref.refKind) {
    case 'tag':
      return { ...base, type: 'add_tag', params: { tagId: ref.refId } };
    case 'support_mark':
      return { ...base, type: 'set_support_mark', params: { markId: ref.refId } };
    case 'template':
      return { ...base, type: 'send_message', params: { templateId: ref.refId } };
    case 'scenario':
      return { ...base, type: 'start_scenario', params: { scenarioId: ref.refId } };
    case 'outgoing_webhook':
      return { ...base, type: 'send_webhook', params: { webhookId: ref.refId } };
    default:
      return null;
  }
}

async function commonActionPlan(
  db: D1Database,
  lineAccountId: string,
  ref: IncomingWebhookActionRef,
): Promise<ActionDefinition[]> {
  const version = await db.prepare(
    `SELECT v.action_config
       FROM common_actions a
       JOIN common_action_versions v
         ON v.id = COALESCE(?, a.current_published_version_id)
        AND v.common_action_id = a.id AND v.status = 'published'
      WHERE a.id = ? AND a.line_account_id = ? AND a.status = 'published'`,
  ).bind(ref.refVersionId, ref.refId, lineAccountId).first<{ action_config: string }>();
  if (!version) throw new Error('公開済みの共通アクションが見つかりません');
  const parsed: unknown = JSON.parse(version.action_config);
  if (!Array.isArray(parsed)) throw new Error('共通アクションの内容が壊れています');
  return parsed as ActionDefinition[];
}

/**
 * N-367 (#939): 人が見つからなかった届物を「確認する箱」へ置く。
 *
 * unmatched_box / create_candidate はどちらも同じ箱の1行で、
 * 違いは kind だけ（「未照合として確認」か「友だち候補として残す」か）。
 * 自動で友だちは作らない。外部から届いた名乗りをそのまま友だちに
 * すると成り済ませられるため、人が確かめてから結び付ける。
 * 同じ受信の再送は台帳側の UNIQUE で増えない。
 */
/** 照合に使おうとした値の並び。箱の中で運用者が確かめるためのもの。 */
function identityAttemptsOf(payload: unknown, config: IncomingWebhookIdentityMatch) {
  return config.methods
    .map((method) => {
      const raw = valueAtPath(payload, method.path);
      const value = typeof raw === 'string' ? raw.trim()
        : typeof raw === 'number' ? String(raw) : '';
      return { kind: method.kind, path: method.path, value: value.slice(0, 200) };
    })
    .filter((attempt) => attempt.value !== '');
}

async function recordNotFound(
  db: D1Database,
  input: {
    webhookId: string;
    lineAccountId: string;
    sourceEventId: string;
    payload: unknown;
    identityMatching: IncomingWebhookIdentityMatch;
    execution?: IncomingWebhookExecution;
  },
): Promise<void> {
  const onNotFound = input.identityMatching.onNotFound;
  if (onNotFound === 'do_nothing') return;
  const record = () => recordIncomingWebhookUnmatched(db, {
    webhookId: input.webhookId,
    lineAccountId: input.lineAccountId,
    sourceEventId: input.sourceEventId,
    kind: onNotFound === 'create_candidate' ? 'candidate' : 'unmatched',
    identityAttempts: identityAttemptsOf(input.payload, input.identityMatching),
    maskedShape: maskedPayloadShape(input.payload),
    receivedAt: input.execution?.occurredAt,
  });
  if (input.execution) await input.execution.step('unmatched', record);
  else await record();
}

/**
 * S (#939 機能26): 同じ値の友だちが2人以上いた届物を箱へ保留する。
 * onNotFound の設定に関わらず必ず置く。自動で先頭だけ選んで動かすと、
 * まったく別の友だちにタグやメッセージが届いてしまうため。
 * 同じ受信の再送は台帳側の UNIQUE で増えない。
 */
async function recordAmbiguous(
  db: D1Database,
  input: {
    webhookId: string;
    lineAccountId: string;
    sourceEventId: string;
    payload: unknown;
    identityMatching: IncomingWebhookIdentityMatch;
    candidateFriendIds: string[];
    execution?: IncomingWebhookExecution;
  },
): Promise<void> {
  const record = () => recordIncomingWebhookUnmatched(db, {
    webhookId: input.webhookId,
    lineAccountId: input.lineAccountId,
    sourceEventId: input.sourceEventId,
    kind: 'ambiguous',
    identityAttempts: identityAttemptsOf(input.payload, input.identityMatching),
    maskedShape: maskedPayloadShape(input.payload),
    candidateFriendIds: input.candidateFriendIds,
    receivedAt: input.execution?.occurredAt,
  });
  if (input.execution) await input.execution.step('ambiguous', record);
  else await record();
}

export async function executeIncomingWebhookActions(
  db: D1Database,
  input: {
    lineAccountId: string;
    webhookId: string;
    sourceEventId: string;
    payload: unknown;
    identityMatching: IncomingWebhookIdentityMatch;
    actions: IncomingWebhookActionRef[];
    dependencies?: AutomationActionExecutorDependencies;
    execution?: IncomingWebhookExecution;
  },
): Promise<ActionRunResult> {
  db = input.execution?.db ?? db;
  /*
   * 処理も未照合時の扱いも無いなら、照合そのものを省く(従来どおり)。
   * 「見つからなかったら箱へ置く」が選ばれているときは、処理が0件でも
   * 照合だけは行い、見つからなければ箱へ置く。
   */
  if (input.actions.length === 0 && input.identityMatching.onNotFound === 'do_nothing') {
    return { matchedFriendId: null, executed: 0, failed: 0, matchStatus: 'skipped' };
  }
  const resolve = () => resolveFriendMatch(db, input.lineAccountId, input.payload, input.identityMatching);
  const match = input.execution ? await input.execution.step('matched-friend', resolve) : await resolve();
  if (match.status === 'ambiguous') {
    await recordAmbiguous(db, { ...input, candidateFriendIds: match.friendIds });
    return { matchedFriendId: null, executed: 0, failed: 0, matchStatus: 'ambiguous' };
  }
  if (match.status === 'not_found') {
    await recordNotFound(db, input);
    return { matchedFriendId: null, executed: 0, failed: 0, matchStatus: 'not_found' };
  }
  const friendId = match.friendId;
  if (input.actions.length === 0) {
    return { matchedFriendId: friendId, executed: 0, failed: 0, matchStatus: 'matched' };
  }

  const executors = createAutomationActionExecutors(input.dependencies);
  let executed = 0;
  let failed = 0;
  let sequence = 0;
  const plans: Array<{ refIndex: number; ref: IncomingWebhookActionRef; plan: ActionDefinition[] }> = [];
  for (const [refIndex, ref] of input.actions.entries()) {
    let plan: ActionDefinition[];
    try {
      const makePlan = async () => ref.refKind === 'common_action'
        ? await commonActionPlan(db, input.lineAccountId, ref)
        : [directAction(ref, sequence)].filter((item): item is ActionDefinition => item !== null);
      plan = input.execution ? await input.execution.step(`plan:${refIndex}`, makePlan) : await makePlan();
      if (plan.length === 0) throw new Error(`未対応の受信Webhook処理です: ${ref.refKind}`);
    } catch (error) {
      console.error('[incoming-webhook-actions] plan failed', error);
      // 再送する受信は完了済みの先頭部分だけを省略する。途中を飛ばすと、
      // 復旧後に先の処理が再実行されて後の処理の結果を上書きしてしまう。
      if (input.execution) throw error;
      failed++;
      continue;
    }
    plans.push({ refIndex, ref, plan });
    sequence += plan.length;
  }
  // LINE rich-menu link/unlink has no provider Retry-Key. A receipt may retry
  // one final-state operation, but must never replay an earlier state over a later one.
  if (input.execution && plans.flatMap(({ plan }) => plan)
    .filter(action => action.type === 'switch_rich_menu' || action.type === 'remove_rich_menu').length > 1) {
    throw new Error('incoming_rich_menu_multiple_final_states');
  }
  for (const { refIndex, ref, plan } of plans) {
    for (const [actionIndex, action] of plan.entries()) {
      const executor = executors[action.type];
      if (!executor) {
        if (input.execution) throw new Error(`未対応の受信Webhook行動です: ${action.type}`);
        failed++;
        continue;
      }
      const stepKey = `action:${refIndex}:${actionIndex}`;
      const stepExecutionId = await stableWebhookStepId(input.sourceEventId, stepKey);
      const context: AutomationActionContext = {
        db,
        runId: input.sourceEventId,
        lineAccountId: input.lineAccountId,
        automationId: `incoming-webhook:${input.webhookId}`,
        automationVersionId: input.webhookId,
        friendId,
        sourceEventId: input.sourceEventId,
        inputEvent: { type: 'incoming_webhook', payload: input.payload },
        action,
        stepExecutionId,
        idempotencyKey: stepExecutionId,
        attemptNumber: 1,
        commonActionVersionId: ref.refVersionId,
        isTest: false,
      };
      try {
        if (input.execution) {
          await input.execution.step(stepKey, () => executor(context));
        } else {
          await executor(context);
        }
        executed++;
      } catch (error) {
        console.error(`[incoming-webhook-actions] action=${action.id} failed`, error);
        // 副作用の成功後でも、checkpointが保存できなければ後続へ進まない。
        // actionのonFailureに関係なく受信全体を再試行し、順序を維持する。
        if (input.execution) throw error;
        failed++;
      }
    }
  }
  return { matchedFriendId: friendId, executed, failed, matchStatus: 'matched' };
}

/**
 * S (#939 機能26): 受け取りの試し。届いたつもりのJSONを照合と
 * 行動の組み立てまで試すが、実行も記録(箱・見本)もしない。
 * 行動の内訳は common_action は公開済み版を展開し、直接指定は
 * 種類だけ返す(実行しないので副作用は無い)。
 */
export type IncomingWebhookPreview = {
  match: IncomingFriendMatch;
  identityAttempts: Array<{ kind: string; path: string; value: string }>;
  actions: Array<
    | { refIndex: number; ref: IncomingWebhookActionRef; ok: true; plan: Array<{ type: string }> }
    | { refIndex: number; ref: IncomingWebhookActionRef; ok: false; error: string }
  >;
};

export async function previewIncomingWebhook(
  db: D1Database,
  input: {
    lineAccountId: string;
    payload: unknown;
    identityMatching: IncomingWebhookIdentityMatch;
    actions: IncomingWebhookActionRef[];
  },
): Promise<IncomingWebhookPreview> {
  const match = await resolveFriendMatch(db, input.lineAccountId, input.payload, input.identityMatching);
  const actions: IncomingWebhookPreview['actions'] = [];
  let sequence = 0;
  for (const [refIndex, ref] of input.actions.entries()) {
    try {
      const plan = ref.refKind === 'common_action'
        ? await commonActionPlan(db, input.lineAccountId, ref)
        : [directAction(ref, sequence)].filter((item): item is ActionDefinition => item !== null);
      if (plan.length === 0) throw new Error(`未対応の受信Webhook処理です: ${ref.refKind}`);
      actions.push({ refIndex, ref, ok: true, plan: plan.map((action) => ({ type: action.type })) });
      sequence += plan.length;
    } catch (error) {
      actions.push({
        refIndex,
        ref,
        ok: false,
        error: error instanceof Error ? error.message : '処理の確認に失敗しました',
      });
    }
  }
  return {
    match,
    identityAttempts: identityAttemptsOf(input.payload, input.identityMatching),
    actions,
  };
}
