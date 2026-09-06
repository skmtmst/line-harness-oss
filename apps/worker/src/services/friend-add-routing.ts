/**
 * 友だち追加時の配信の振り分け（設計 V2 4-6）。
 *
 * 友だち追加の通知が来たとき、相手が「はじめての人」か「以前からの友だち・
 * ブロックを解除した人」かを見て、流すシナリオを分ける。
 *
 * **置き場は `account_settings`。新しいテーブルは作っていない。**
 * `feature-settings.ts` と同じ判断（key/value の置き場が既にある）。
 */
import {
  getAccountSetting,
  setAccountSetting,
  getScenarios,
  enrollFriendInScenario,
  resumeFriendScenario,
  postMileageEntry,
  type FriendScenario,
  type FriendAddRuleDefinition,
  ensureFriendAddFallbackRules,
} from '@line-crm/db';
import {
  FRIEND_ADD_ROUTING_DEFAULT,
  type FriendAddRouting,
  type FriendAddAction,
  type FriendAddBranch,
  type FriendAddFirstTimeCriterion,
  type FriendAddReturningMode,
  type FriendAddRowActionType,
  type FriendAddStartPosition,
  type FriendAddTiming,
} from '@line-crm/shared';
import { attachTagAndFireSideEffects } from './friend-tag-attach.js';
import type { ImmediatePushContext } from './immediate-first-step.js';

export const FRIEND_ADD_ROUTING_KEY = 'friend_add_routing';

/** 振り分けの判定に使う、友だちの最低限の情報。 */
export interface FriendAddSubject {
  id: string;
  unfollow_count?: number | null;
  first_followed_at?: string | null;
}

export type FriendKind = 'first_time' | 'returning';

// ── 読み書き ────────────────────────────────────────────────────────────────

function pickString<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

const ROW_ACTION_TYPES = ['tag', 'friend_field', 'support_mark', 'scenario', 'common_var'] as const;

function normalizeActions(value: unknown): FriendAddAction[] {
  if (!Array.isArray(value)) return [];
  const out: FriendAddAction[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const kind = (item as { kind?: unknown }).kind;
    if (kind === 'tag') {
      /*
       * 古い形。**読むときに新しい形へ直す。**
       *
       * 以前は「タグを1つ付ける」しかできなかった。外すこともフォルダを
       * 指定することもできない。シナリオ側には同じことをする仕組みが
       * あるので、そちらへ寄せた。既に保存されている設定を読めなくすると
       * 「設定が消えた」ことになるので、ここで直す。
       */
      const tagId = (item as { tagId?: unknown }).tagId;
      if (typeof tagId === 'string' && tagId) {
        out.push({ kind: 'row', actionType: 'tag', config: { op: 'add', tagIds: [tagId] } });
      }
    } else if (kind === 'mile') {
      const amount = (item as { amount?: unknown }).amount;
      if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
        out.push({ kind: 'mile', amount: Math.floor(amount) });
      }
    } else if (kind === 'row') {
      const actionType = (item as { actionType?: unknown }).actionType;
      if (typeof actionType === 'string' && (ROW_ACTION_TYPES as readonly string[]).includes(actionType)) {
        out.push({
          kind: 'row',
          actionType: actionType as FriendAddRowActionType,
          config: (item as { config?: unknown }).config ?? {},
        });
      }
    }
  }
  return out;
}

function normalizeScenarioId(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * 保存された JSON を型に落とす。**壊れた値は既定に倒す。**
 * 設定の読み込みで例外を投げると、友だち追加そのものが落ちる。
 */
export function normalizeRouting(raw: unknown): FriendAddRouting {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const first = (obj.firstTime && typeof obj.firstTime === 'object'
    ? obj.firstTime
    : {}) as Record<string, unknown>;
  const ret = (obj.returning && typeof obj.returning === 'object'
    ? obj.returning
    : {}) as Record<string, unknown>;
  const crit = (obj.criteria && typeof obj.criteria === 'object'
    ? obj.criteria
    : {}) as Record<string, unknown>;

  return {
    firstTime: {
      scenarioId: normalizeScenarioId(first.scenarioId),
      timing: pickString<FriendAddTiming>(
        first.timing,
        ['immediate', 'scenario'],
        FRIEND_ADD_ROUTING_DEFAULT.firstTime.timing,
      ),
      actions: normalizeActions(first.actions),
    },
    returning: {
      scenarioId: normalizeScenarioId(ret.scenarioId),
      mode: pickString<FriendAddReturningMode>(
        ret.mode,
        ['none', 'other', 'same'],
        FRIEND_ADD_ROUTING_DEFAULT.returning.mode,
      ),
      startPosition: pickString<FriendAddStartPosition>(
        ret.startPosition,
        ['beginning', 'resume'],
        FRIEND_ADD_ROUTING_DEFAULT.returning.startPosition,
      ),
      actions: normalizeActions(ret.actions),
    },
    criteria: {
      firstTime: pickString<FriendAddFirstTimeCriterion>(
        crit.firstTime,
        ['unfollow_count_zero', 'first_followed_at_missing'],
        FRIEND_ADD_ROUTING_DEFAULT.criteria.firstTime,
      ),
    },
  };
}

/**
 * 保存済みの設定を読む。**まだ保存されていなければ `null`。**
 *
 * `null` と既定値を区別すること。設定していないアカウントは
 * 「friend_add シナリオを全部流す」という**いままでの挙動**のままにする。
 */
export async function loadFriendAddRouting(
  db: D1Database,
  accountId: string,
): Promise<FriendAddRouting | null> {
  const raw = await getAccountSetting(db, accountId, FRIEND_ADD_ROUTING_KEY);
  if (!raw) return null;
  try {
    return normalizeRouting(JSON.parse(raw));
  } catch {
    // 壊れた JSON が入っていても配信は止めない。設定していない扱いにする。
    console.error(`[friend-add-routing] broken JSON for account=${accountId}`);
    return null;
  }
}

export async function saveFriendAddRouting(
  db: D1Database,
  accountId: string,
  routing: FriendAddRouting,
): Promise<void> {
  await setAccountSetting(
    db,
    accountId,
    FRIEND_ADD_ROUTING_KEY,
    JSON.stringify(routing),
  );
}

// ── 判定 ────────────────────────────────────────────────────────────────────

/**
 * この人は「はじめて」か「以前から」か。
 *
 * 既定は `unfollow_count_zero`。ブロックしたことが一度も無ければ「はじめて」。
 * 友だち追加の通知はブロック解除でも飛ぶので、この経路ではこれで足りる。
 *
 * 設計の絵の `first_followed_at_missing`（初回フォロー日が未記録）は選べる形に
 * してあるが、**この環境では使えない**。マイグレーション 065 が既存の行すべてに
 * 初回フォロー日を埋めたので、未記録の人がもう居ない。選ぶと全員が
 * 「以前から」になる。画面でもその旨を出している。
 */
export function classifyFriend(
  friend: FriendAddSubject,
  criterion: FriendAddFirstTimeCriterion,
): FriendKind {
  if (criterion === 'first_followed_at_missing') {
    return friend.first_followed_at ? 'returning' : 'first_time';
  }
  return (friend.unfollow_count ?? 0) === 0 ? 'first_time' : 'returning';
}

// ── 実行 ────────────────────────────────────────────────────────────────────

async function runActions(
  db: D1Database,
  friendId: string,
  actions: FriendAddAction[],
  push?: ImmediatePushContext,
): Promise<void> {
  /*
   * シナリオと同じアクションは、シナリオと同じところで実行する。
   *
   * 自前で書くと、条件付き実行・順次実行・失敗の切り離しを2か所で
   * 保つことになり、必ずどちらかがずれる。行の形だけ合わせて渡す。
   * `scenario_id` などはシナリオ側の都合の列なので、ここでは空で埋める。
   */
  const rows = actions
    .filter((a): a is Extract<FriendAddAction, { kind: 'row' }> => a.kind === 'row')
    .map((a, i) => ({
      id: `friend-add-${i}`,
      scenario_id: '',
      hook: 'on_enroll' as const,
      step_id: null,
      choice_index: null,
      sort_order: i,
      action_type: a.actionType,
      config_json: JSON.stringify(a.config ?? {}),
      condition_json: null,
      repeat_on_refire: 1,
    }));
  if (rows.length > 0) {
    try {
      const { runActionRows } = await import('./scenario-actions.js');
      await runActionRows(db, rows as never, friendId);
    } catch (err) {
      // 1つ失敗しても配信は止めない。
      console.error('[friend-add-routing] row actions failed:', err);
    }
  }

  for (const action of actions) {
    try {
      if (action.kind === 'tag') {
        // 読み込みで row へ直しているので、ここへは来ない。古い保存を
        // そのまま渡された場合の保険として残す。
        await attachTagAndFireSideEffects(db, friendId, action.tagId, push);
      } else if (action.kind === 'mile') {
        // 直接台帳へ1行入れる。付与ルール（/scoring）は「こういう行動をしたら
        // 何マイル」を決めるもので、友だち追加の1回だけの付与はここで足す。
        // idempotencyKey に friend を入れているので、同じ人に二重で入らない。
        await postMileageEntry(db, {
          beneficiaryFriendId: friendId,
          entryType: 'grant',
          amount: action.amount,
          reason: '友だち追加',
          source: 'friend_add_routing',
          sourceEventId: friendId,
          idempotencyKey: `friend_add_routing:${friendId}:${action.amount}`,
        });
      }
    } catch (err) {
      // 1つ失敗しても残りは実行する。配信そのものは止めない。
      console.error(`[friend-add-routing] action ${action.kind} failed:`, err);
    }
  }
}

export interface FriendAddEnrollment {
  scenarioId: string;
  enrollment: FriendScenario;
  /**
   * 「前回読んだところから」で既にある行を生かした場合 true。
   *
   * **このときは1通目を即時に送ってはいけない。** `pushImmediateFirstStep` は
   * 名前のとおり1通目を出すので、続きから再開した人にもう一度1通目が届く。
   * 再開のぶんは `next_delivery_at` を見て cron が次の通を出す。
   */
  resumed: boolean;
}

export interface FriendAddRoutingResult {
  /** 設定が無く、いままでどおり全部流す場合は false */
  routed: boolean;
  kind: FriendKind | null;
  /** 実際に登録した行 */
  enrollments: FriendAddEnrollment[];
  /** ①の「開始のタイミング」。呼ぶ側が即時に出すかを決める */
  timing: FriendAddTiming;
  /** 「配信しない」を選んでいて何も流さなかった場合 true */
  suppressed: boolean;
  /** V6の複数ルールで選ばれた設定と公開版。旧設定ではどちらもnull。 */
  ruleId: string | null;
  ruleVersionId: string | null;
}

function ruleActions(value: unknown[]): FriendAddAction[] {
  const actions: FriendAddAction[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const action = item as {
      type?: unknown;
      targetId?: unknown;
      tagId?: unknown;
      amount?: unknown;
      kind?: unknown;
      actionType?: unknown;
      config?: Record<string, unknown>;
    };
    // migration 290で旧JSONの共通アクションをそのまま固定した公開版も読める。
    if (action.kind === 'row' && typeof action.actionType === 'string') {
      actions.push({ kind: 'row', actionType: action.actionType as FriendAddRowActionType, config: action.config ?? {} });
      continue;
    }
    if (action.kind === 'tag' && typeof action.tagId === 'string' && action.tagId) {
      actions.push({ kind: 'row', actionType: 'tag', config: { op: 'add', tagIds: [action.tagId] } });
      continue;
    }
    if (action.kind === 'mile' && typeof action.amount === 'number' && action.amount > 0) {
      actions.push({ kind: 'mile', amount: Math.floor(action.amount) });
      continue;
    }
    const targetId = typeof action.targetId === 'string' ? action.targetId : '';
    if (action.type === 'add_tag' && targetId) {
      actions.push({ kind: 'row', actionType: 'tag', config: { op: 'add', tagIds: [targetId] } });
    } else if (action.type === 'remove_tag' && targetId) {
      actions.push({ kind: 'row', actionType: 'tag', config: { op: 'remove', tagIds: [targetId] } });
    } else if (action.type === 'start_scenario' && targetId) {
      actions.push({ kind: 'row', actionType: 'scenario', config: { op: 'start', scenarioId: targetId, restart: 'from_start' } });
    }
  }
  return actions;
}

async function loadPublishedFriendAddRule(
  db: D1Database,
  input: { accountId: string; kind: FriendKind; entryRouteId: string | null },
): Promise<{
  ruleId: string;
  versionId: string;
  definition: FriendAddRuleDefinition;
} | null> {
  try {
    const row = await db.prepare(
      `SELECT r.id AS rule_id, v.id AS version_id, v.definition_snapshot
         FROM friend_add_rules r
         JOIN friend_add_rule_versions v ON v.id = r.current_version_id AND v.status = 'published'
        WHERE r.line_account_id = ? AND r.friend_kind = ?
          AND r.status = 'published' AND r.archived_at IS NULL
          AND (
            (r.is_unknown_route_fallback = 0 AND ? IS NOT NULL AND EXISTS (
              SELECT 1 FROM json_each(v.definition_snapshot, '$.routeIds') WHERE value = ?
            ))
            OR r.is_unknown_route_fallback = 1
          )
          AND (json_extract(v.definition_snapshot, '$.activeFrom') IS NULL
               OR json_extract(v.definition_snapshot, '$.activeFrom') <= strftime('%Y-%m-%dT%H:%M', 'now', '+9 hours'))
          AND (json_extract(v.definition_snapshot, '$.activeUntil') IS NULL
               OR json_extract(v.definition_snapshot, '$.activeUntil') >= strftime('%Y-%m-%dT%H:%M', 'now', '+9 hours'))
        ORDER BY r.is_unknown_route_fallback ASC, r.priority ASC, r.created_at ASC
        LIMIT 1`,
    ).bind(input.accountId, input.kind, input.entryRouteId, input.entryRouteId).first<{
      rule_id: string;
      version_id: string;
      definition_snapshot: string;
    }>();
    if (!row) return null;
    return {
      ruleId: row.rule_id,
      versionId: row.version_id,
      definition: JSON.parse(row.definition_snapshot) as FriendAddRuleDefinition,
    };
  } catch (error) {
    // DB更新より先にWorkerだけが切り替わった短い時間は、旧設定へ安全に戻す。
    if (error instanceof Error && error.message.includes('no such table: friend_add_rules')) return null;
    throw error;
  }
}

/**
 * 設定に従って登録する。
 *
 * **設定が保存されていないアカウントでは何もしない**（`routed: false`）。
 * 呼ぶ側は、そのときだけ従来どおり全 friend_add シナリオを流す。
 */
export async function applyFriendAddRouting(
  db: D1Database,
  accountId: string | null,
  friend: FriendAddSubject,
  push?: ImmediatePushContext,
  routingContext?: { entryRouteId?: string | null },
): Promise<FriendAddRoutingResult> {
  const none: FriendAddRoutingResult = {
    routed: false,
    kind: null,
    enrollments: [],
    timing: FRIEND_ADD_ROUTING_DEFAULT.firstTime.timing,
    suppressed: false,
    ruleId: null,
    ruleVersionId: null,
  };
  if (!accountId) return none;

  const kind = classifyFriend(friend, FRIEND_ADD_ROUTING_DEFAULT.criteria.firstTime);
  await ensureFriendAddFallbackRules(db, accountId);
  const matchedRule = await loadPublishedFriendAddRule(db, {
    accountId,
    kind,
    entryRouteId: routingContext?.entryRouteId ?? null,
  });
  const routing = matchedRule
    ? {
        firstTime: {
          scenarioId: matchedRule.definition.scenarioId,
          timing: matchedRule.definition.timing,
          actions: ruleActions(matchedRule.definition.actions),
        },
        returning: {
          scenarioId: matchedRule.definition.scenarioId,
          mode: matchedRule.definition.returningMode ?? 'other',
          startPosition: matchedRule.definition.startPosition ?? 'beginning',
          actions: ruleActions(matchedRule.definition.actions),
        },
        criteria: FRIEND_ADD_ROUTING_DEFAULT.criteria,
      } satisfies FriendAddRouting
    : await loadFriendAddRouting(db, accountId);
  if (!routing) return none;

  const timing = routing.firstTime.timing;
  const classifiedKind = matchedRule ? kind : classifyFriend(friend, routing.criteria.firstTime);

  // ② で「配信しない」を選んでいる
  if (classifiedKind === 'returning' && routing.returning.mode === 'none') {
    await runActions(db, friend.id, routing.returning.actions, push);
    return {
      routed: true,
      kind: classifiedKind,
      enrollments: [],
      timing,
      suppressed: true,
      ruleId: matchedRule?.ruleId ?? null,
      ruleVersionId: matchedRule?.versionId ?? null,
    };
  }

  // ② が「はじめての人と同じもの」なら ① の設定を使う
  const useFirst = classifiedKind === 'first_time' || routing.returning.mode === 'same';
  const branch: FriendAddBranch = useFirst ? routing.firstTime : routing.returning;

  /*
   * シナリオを決めていない。
   *
   * ①（はじめての人）で決めていないのは**意図した設定**。画面にも
   * 「決めていない（有効なシナリオを全部流す）」と書いてある。従来どおり流す。
   *
   * ②で「別のシナリオを配信する」を選んでシナリオが空なのは**書きかけ**。
   * ここで従来どおりに落とすと、**有効な友だち追加シナリオが全部流れる**。
   * この画面は「以前からのお客さまに『はじめまして』を届けない」ために
   * あるのに、書きかけの設定がいちばん困る結果（全部届く）になる。
   *
   * 送らないほうへ倒す。「別のシナリオ」と決めた人が、そのシナリオを
   * 選び忘れただけで全部届くよりは、何も届かないほうがまだ直せる。
   * 画面側でも保存させないようにしてある。
   */
  if (!branch.scenarioId) {
    if (matchedRule) {
      await runActions(db, friend.id, branch.actions, push);
      return {
        routed: true,
        kind: classifiedKind,
        enrollments: [],
        timing,
        suppressed: true,
        ruleId: matchedRule.ruleId,
        ruleVersionId: matchedRule.versionId,
      };
    }
    if (classifiedKind === 'returning' && routing.returning.mode === 'other') {
      console.warn(
        `[friend-add-routing] ②で「別のシナリオ」を選んでシナリオが未設定のため配信しません`
        + `（friend=${friend.id}）。画面の設定を見直してください。`,
      );
      await runActions(db, friend.id, routing.returning.actions, push);
      return {
        routed: true,
        kind: classifiedKind,
        enrollments: [],
        timing,
        suppressed: true,
        ruleId: null,
        ruleVersionId: null,
      };
    }
    return none;
  }

  /*
   * 「前回読んだところから」は、**②に当たる人すべて**で意味がある。
   *
   * 以前は「別のシナリオを選んだとき」だけに絞っていたが、
   * 「はじめての人と同じものを配信する」を選んでいるアカウントで、
   * **ブロックを解除した人に何も届かない**という壊れ方をしていた。
   *
   * ブロック中に購読が止まっている（status='paused'）と、
   * `enrollFriendInScenario` は部分UNIQUE索引（status != 'completed'）に
   * 弾かれて null を返す。resume も呼ばれないので、止まったまま何も起きない。
   * 解除した本人にも、設定した人にも、何が起きていないのか分からない。
   *
   * ①（はじめての人）では効かせない。履歴が無いので resume は必ず空振りし、
   * 呼ぶだけ1クエリ増える。
   */
  const wantResume = classifiedKind === 'returning' && routing.returning.startPosition === 'resume';

  const enrollments: FriendAddEnrollment[] = [];
  let record: FriendScenario | null = null;
  let resumed = false;
  if (wantResume) {
    record = await resumeFriendScenario(db, friend.id, branch.scenarioId);
    resumed = record !== null;
    // 続きが無い（読み終えている・そもそも入っていない）ときは最初から
    if (!record) record = await enrollFriendInScenario(db, friend.id, branch.scenarioId);
  } else {
    record = await enrollFriendInScenario(db, friend.id, branch.scenarioId);
  }
  if (record) {
    enrollments.push({ scenarioId: branch.scenarioId, enrollment: record, resumed });
  }

  await runActions(db, friend.id, branch.actions, push);

  return {
    routed: true,
    kind: classifiedKind,
    enrollments,
    timing,
    suppressed: false,
    ruleId: matchedRule?.ruleId ?? null,
    ruleVersionId: matchedRule?.versionId ?? null,
  };
}

/**
 * 画面の「テスト実行」用。**登録も配信もしない。**
 * この人ならどちらに振り分けられるかだけを返す。
 */
export async function previewFriendAddRouting(
  db: D1Database,
  accountId: string,
  friend: FriendAddSubject,
): Promise<{ configured: boolean; kind: FriendKind; scenarioId: string | null; suppressed: boolean }> {
  const savedRouting = await loadFriendAddRouting(db, accountId);
  const routing = savedRouting ?? FRIEND_ADD_ROUTING_DEFAULT;
  const configured = savedRouting !== null;
  return { configured, ...previewFriendAddRoutingDefinition(routing, friend) };
}

/**
 * 下書きのdry-runと本番前確認が共有する判定器。
 * DBへの登録・配信・タグ付けは行わず、実行時と同じ分岐だけを返す。
 */
export function previewFriendAddRoutingDefinition(
  routing: FriendAddRouting,
  friend: FriendAddSubject,
): { kind: FriendKind; scenarioId: string | null; suppressed: boolean; actionCount: number } {
  const kind = classifyFriend(friend, routing.criteria.firstTime);
  if (kind === 'returning' && routing.returning.mode === 'none') {
    return {
      kind,
      scenarioId: null,
      suppressed: true,
      actionCount: routing.returning.actions.length,
    };
  }
  const useFirst = kind === 'first_time' || routing.returning.mode === 'same';
  const branch = useFirst ? routing.firstTime : routing.returning;
  return {
    kind,
    scenarioId: branch.scenarioId,
    suppressed: false,
    actionCount: branch.actions.length,
  };
}

/** 画面が選択肢を出すための friend_add シナリオ一覧。 */
export async function listFriendAddScenarios(
  db: D1Database,
  accountId: string | null,
): Promise<{ id: string; name: string }[]> {
  /*
   * 候補は**すべてのシナリオ**にする。
   *
   * これまで trigger_type === 'friend_add' のものだけを出していたので、
   * 「このシナリオを友だち追加で流したい」と思っても、シナリオ側の設定を
   * 先に変えないと選べなかった。呼ぶ側で選ぶのが自然なので、ここで絞らない。
   *
   * アカウント違いだけは外す。他のアカウントのシナリオを選んでも配れない。
   */
  const scenarios = await getScenarios(db);
  return scenarios
    .filter(s => !s.line_account_id || !accountId || s.line_account_id === accountId)
    .map(s => ({ id: s.id, name: s.name }));
}
