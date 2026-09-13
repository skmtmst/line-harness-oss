import { accountFeatureOffExclusionSql } from './account-settings.js';
import { jstNow } from './utils.js';
import { computeNextDeliveryAt } from './scenario-schedule.js';
import { resolveStepContent } from './scenario-resolve.js';
import {
  buildFriendScenariosDueForDeliveryQuery,
  normalizeScenarioDeliveryTimestamp,
  SCENARIO_DELIVERY_BATCH_LIMIT,
} from './scenario-delivery-timestamps.js';
export type ScenarioTriggerType = 'friend_add' | 'tag_added' | 'form_answer' | 'booking_confirmed' | 'manual';
export type MessageType = 'text' | 'image' | 'flex' | 'location' | 'video' | 'audio' | 'sticker' | 'carousel';
export type FriendScenarioStatus = 'active' | 'paused' | 'completed' | 'delivering';
export type DeliveryMode = 'relative' | 'elapsed' | 'absolute_time';

export interface Scenario {
  id: string;
  name: string;
  description: string | null;
  trigger_type: ScenarioTriggerType;
  trigger_tag_id: string | null;
  line_account_id: string | null;
  is_active: number;
  delivery_mode: DeliveryMode;
  /** 他のシナリオと同時に動いてよいか。1 が既定（並行を許す） */
  allow_concurrent: number;
  /** 一覧での並び順。小さいほど上（113 で追加） */
  display_order: number;
  /** 置き場（099 で追加）。未分類は null。 */
  folder_id: string | null;
  /** シナリオ全体の配信対象（120）。SegmentCondition の JSON。null は条件なし。 */
  audience_condition_json: string | null;
  /** 最終コンテンツを配り終えたあと（121）。'pause' | 'resume_previous' | 'move' */
  on_complete_mode: string;
  /** on_complete_mode が 'move' のときの移動先（122）。 */
  on_complete_scenario_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScenarioStep {
  id: string;
  scenario_id: string;
  step_order: number;
  delay_minutes: number;
  message_type: MessageType;
  message_content: string;
  condition_type: string | null;
  condition_value: string | null;
  next_step_on_false: number | null;
  offset_days: number | null;
  offset_minutes: number | null;
  delivery_time: string | null;
  template_id: string | null;
  on_reach_tag_id: string | null;
  /** この通を送ったあと。'continue' で次へ、'pause' で止める（113 で追加） */
  after_send: string;
  /** 1通ごとの配信対象（124）。SegmentCondition の JSON。null は購読中の全員。 */
  target_condition_json: string | null;
  /** 質問メッセージ（125）。ScenarioQuestion の JSON。null なら質問ではない。 */
  question_json: string | null;
  /** 下書き（126）。1 なら配信しない。 */
  is_draft: number;
  created_at: string;
}

export interface ScenarioWithSteps extends Scenario {
  steps: ScenarioStep[];
}

export interface FriendScenario {
  id: string;
  friend_id: string;
  scenario_id: string;
  current_step_order: number;
  status: FriendScenarioStatus;
  started_at: string;
  next_delivery_at: string | null;
  /** 割り込む前に読んでいたシナリオ（123）。「1つ前のシナリオを再開」で使う。 */
  previous_scenario_id: string | null;
  /** 開始時に固定した公開版（351）。配信はこの版だけを読む。 */
  published_version_id: string | null;
  updated_at: string;
}

/**
 * 公開版（351）。公開操作のたびに1行作る不変のスナップショット。
 * 通の配列は steps_snapshot の JSON に固定し、行の更新・削除は
 * トリガーで禁じている（自動応答の公開版 273 と同じ流儀）。
 */
export interface ScenarioVersion {
  id: string;
  scenario_id: string;
  version_number: number;
  delivery_mode: DeliveryMode;
  audience_condition_json: string | null;
  on_complete_mode: string;
  on_complete_scenario_id: string | null;
  steps_snapshot: string;
  /**
   * 公開時に写したアクション設定（scenario_actions）の JSON 配列。
   * これが無いと、旧版に固定された購読でも常に live のアクションが動き、
   * 公開後の編集が混入する。
   */
  actions_snapshot: string;
  status: 'published' | 'retired';
  published_at: string;
  published_by_staff_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 公開操作の冪等キー台帳（351）。同じキーの再実行は同じ版を返し、
 * 別内容・別シナリオでの使い回しは SCENARIO_PUBLISH_KEY_CONFLICT（409）に
 * する。同内容の公開でもキーを残すので、あとから別内容で再利用したら
 * 必ず検出できる。
 */
export interface ScenarioPublishKey {
  publish_idempotency_key: string;
  scenario_id: string;
  version_id: string;
  content_snapshot: string;
  created_at: string;
}

/**
 * 版に固定された通。`id` は版所有の通ID（`<版ID>:<通番>`）で、live の
 * scenario_steps.id ではない。配信の同一性・二重送信防止はこのIDで見る。
 * live 側のIDは履歴づけの控え（live_step_id）にだけ残す。通が消された
 * あとは null になることがある。配信の判断には使わない。
 */
export interface PinnedScenarioStep extends ScenarioStep {
  live_step_id: string | null;
  /** 公開時に確定した template。配信時に templates 表を読まない。 */
  template_id_at_send: string | null;
}

// ============================================================
// Scenario CRUD
// ============================================================

export type ScenarioWithStepCount = Scenario & { step_count: number };

/**
 * 並び順をまとめて書く。
 *
 * 1件ずつ当てると、10件動かしたときに10往復する。その途中で誰かが一覧を
 * 開くと、半分だけ入れ替わった並びが見える。渡された順に 0,1,2… を振る。
 */
export async function reorderScenarios(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    ids.map((id, i) =>
      db.prepare(`UPDATE scenarios SET display_order = ? WHERE id = ?`).bind(i, id),
    ),
  );
}

export async function getScenarios(db: D1Database): Promise<ScenarioWithStepCount[]> {
  const result = await db
    .prepare(
      `SELECT s.*, COUNT(ss.id) as step_count
       FROM scenarios s
       LEFT JOIN scenario_steps ss ON s.id = ss.scenario_id
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
    )
    .all<ScenarioWithStepCount>();
  return result.results;
}

export async function getScenarioById(
  db: D1Database,
  id: string,
): Promise<ScenarioWithSteps | null> {
  const scenario = await db
    .prepare(`SELECT * FROM scenarios WHERE id = ?`)
    .bind(id)
    .first<Scenario>();

  if (!scenario) return null;

  const stepsResult = await db
    .prepare(
      `SELECT * FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC`,
    )
    .bind(id)
    .all<ScenarioStep>();

  return { ...scenario, steps: stepsResult.results };
}

export interface CreateScenarioInput {
  name: string;
  description?: string | null;
  triggerType: ScenarioTriggerType;
  triggerTagId?: string | null;
  deliveryMode?: DeliveryMode;
  /** 他のシナリオと同時に動いてよいか。省略時は許す（従来どおり） */
  allowConcurrent?: boolean;
}

export async function createScenario(
  db: D1Database,
  input: CreateScenarioInput,
): Promise<Scenario> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      // allow_concurrent は必ず渡す。列の既定は 0 だが、それは
      // 「他のシナリオが動いていたら登録しない」という強い動きになる。
      // 既定は従来どおり「並行を許す」(1) にする。
      `INSERT INTO scenarios (id, name, description, trigger_type, trigger_tag_id, is_active, delivery_mode, allow_concurrent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.description ?? null,
      input.triggerType,
      input.triggerTagId ?? null,
      input.deliveryMode ?? 'relative',
      input.allowConcurrent === false ? 0 : 1,
      now,
      now,
    )
    .run();

  return (await db
    .prepare(`SELECT * FROM scenarios WHERE id = ?`)
    .bind(id)
    .first<Scenario>())!;
}

export type UpdateScenarioInput = Partial<
  Pick<
    Scenario,
    | 'name'
    | 'description'
    | 'trigger_type'
    | 'trigger_tag_id'
    | 'is_active'
    | 'allow_concurrent'
    | 'folder_id'
    /**
     * 配信方式。**通が1つでもあるときは変えない。**
     * 通の予定の持ち方（delay_minutes / offset_days / delivery_time）が
     * 方式ごとに違うので、あとから変えると予定の意味が変わる。
     * 呼ぶ側（worker）で通の数を見てから渡すこと。
     */
    | 'delivery_mode'
    /** シナリオ全体の配信対象（120）。 */
    | 'audience_condition_json'
    /** 最終コンテンツ配信後の処理（121/122）。 */
    | 'on_complete_mode'
    | 'on_complete_scenario_id'
  >
>;

export async function updateScenario(
  db: D1Database,
  id: string,
  updates: UpdateScenarioInput,
): Promise<Scenario | null> {
  const now = jstNow();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.trigger_type !== undefined) {
    fields.push('trigger_type = ?');
    values.push(updates.trigger_type);
  }
  if (updates.allow_concurrent !== undefined) {
    fields.push('allow_concurrent = ?');
    values.push(updates.allow_concurrent);
  }
  if (updates.trigger_tag_id !== undefined) {
    fields.push('trigger_tag_id = ?');
    values.push(updates.trigger_tag_id);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.is_active);
  }
  if (updates.folder_id !== undefined) {
    fields.push('folder_id = ?');
    values.push(updates.folder_id);
  }
  if (updates.delivery_mode !== undefined) {
    fields.push('delivery_mode = ?');
    values.push(updates.delivery_mode);
  }
  if (updates.audience_condition_json !== undefined) {
    fields.push('audience_condition_json = ?');
    values.push(updates.audience_condition_json);
  }
  if (updates.on_complete_mode !== undefined) {
    fields.push('on_complete_mode = ?');
    values.push(updates.on_complete_mode);
  }
  if (updates.on_complete_scenario_id !== undefined) {
    fields.push('on_complete_scenario_id = ?');
    values.push(updates.on_complete_scenario_id);
  }

  if (fields.length === 0) {
    return db
      .prepare(`SELECT * FROM scenarios WHERE id = ?`)
      .bind(id)
      .first<Scenario>();
  }

  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);

  await db
    .prepare(`UPDATE scenarios SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db
    .prepare(`SELECT * FROM scenarios WHERE id = ?`)
    .bind(id)
    .first<Scenario>();
}

/**
 * シナリオの親削除。親子削除と全参照解除を1回の batch（原子）で行う。
 *
 * - 他の機能から参照されている（アフィリエイト案件の completion 連携など）
 *   ときは黙って切らず SCENARIO_HAS_DEPENDENTS（409）にする。勝手に
 *   切ると報酬の支払い条件が静かに壊れる。
 * - 版の削除禁止トリガーは「親が残っている間の削除」だけを止めるので、
 *   親の DELETE を先頭に置く。外部キー制約が有効な環境では親削除で
 *   CASCADE/SET NULL が走り、無効な環境では残るので後段で明示削除・
 *   参照解除する。どちらでも同じ終状態になり、500 にならない。
 * - 参照解除（entry_routes / tracked_links / forms の送信後シナリオ・
 *   他シナリオ完了時の遷移先）も同じ batch に入れる。FK OFF の環境では
 *   CASCADE も SET NULL も走らないので、明示で NULL に寄せる。
 */
export async function deleteScenario(db: D1Database, id: string): Promise<void> {
  const dependent = await db.prepare(
    `SELECT id FROM affiliate_offers WHERE scenario_id = ? LIMIT 1`,
  ).bind(id).first<{ id: string }>();
  if (dependent) throw new Error('SCENARIO_HAS_DEPENDENTS');

  await db.batch([
    db.prepare(`DELETE FROM scenarios WHERE id = ?`).bind(id),
    db.prepare(`DELETE FROM scenario_publish_keys WHERE scenario_id = ?`).bind(id),
    db.prepare(`DELETE FROM scenario_versions WHERE scenario_id = ?`).bind(id),
    db.prepare(
      `DELETE FROM scenario_action_fires WHERE action_id IN (
         SELECT a.id FROM scenario_actions a WHERE a.scenario_id = ?
       )`,
    ).bind(id),
    db.prepare(`DELETE FROM scenario_actions WHERE scenario_id = ?`).bind(id),
    db.prepare(
      `UPDATE messages_log SET scenario_step_id = NULL
        WHERE scenario_step_id IN (SELECT id FROM scenario_steps WHERE scenario_id = ?)`,
    ).bind(id),
    db.prepare(`DELETE FROM scenario_steps WHERE scenario_id = ?`).bind(id),
    db.prepare(`DELETE FROM friend_scenarios WHERE scenario_id = ?`).bind(id),
    db.prepare(`DELETE FROM scenario_triggers WHERE scenario_id = ?`).bind(id),
    db.prepare(`DELETE FROM scenario_drafts WHERE scenario_id = ?`).bind(id),
    db.prepare(`UPDATE entry_routes SET scenario_id = NULL WHERE scenario_id = ?`).bind(id),
    db.prepare(`UPDATE tracked_links SET scenario_id = NULL WHERE scenario_id = ?`).bind(id),
    db.prepare(`UPDATE forms SET on_submit_scenario_id = NULL WHERE on_submit_scenario_id = ?`).bind(id),
    db.prepare(`UPDATE scenarios SET on_complete_scenario_id = NULL WHERE on_complete_scenario_id = ?`).bind(id),
  ]);
}

// ============================================================
// Scenario Steps
// ============================================================

export interface CreateScenarioStepInput {
  scenarioId: string;
  stepOrder: number;
  delayMinutes?: number;
  messageType: MessageType;
  messageContent: string;
  conditionType?: string | null;
  conditionValue?: string | null;
  nextStepOnFalse?: number | null;
  offsetDays?: number | null;
  offsetMinutes?: number | null;
  deliveryTime?: string | null;
  templateId?: string | null;
  onReachTagId?: string | null;
  /** この通を送ったあと。'pause' なら次へ進めず止める。 */
  afterSend?: 'continue' | 'pause';
  /** 1通ごとの配信対象（124）。SegmentCondition の JSON。 */
  targetConditionJson?: string | null;
  /** 質問メッセージ（125）。ScenarioQuestion の JSON。 */
  questionJson?: string | null;
  /** 下書き（126）。 */
  isDraft?: boolean;
}

export async function createScenarioStep(
  db: D1Database,
  input: CreateScenarioStepInput,
): Promise<ScenarioStep> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO scenario_steps
       (id, scenario_id, step_order, delay_minutes, message_type, message_content,
        condition_type, condition_value, next_step_on_false,
        offset_days, offset_minutes, delivery_time,
        template_id, on_reach_tag_id, after_send,
        target_condition_json, question_json, is_draft,
        created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.scenarioId,
      input.stepOrder,
      input.delayMinutes ?? 0,
      input.messageType,
      input.messageContent,
      input.conditionType ?? null,
      input.conditionValue ?? null,
      input.nextStepOnFalse ?? null,
      input.offsetDays ?? null,
      input.offsetMinutes ?? null,
      input.deliveryTime ?? null,
      input.templateId ?? null,
      input.onReachTagId ?? null,
      input.afterSend ?? 'continue',
      input.targetConditionJson ?? null,
      input.questionJson ?? null,
      input.isDraft ? 1 : 0,
      now,
    )
    .run();

  return (await db
    .prepare(`SELECT * FROM scenario_steps WHERE id = ?`)
    .bind(id)
    .first<ScenarioStep>())!;
}

export type UpdateScenarioStepInput = Partial<
  Pick<
    ScenarioStep,
    | 'step_order'
    | 'delay_minutes'
    | 'message_type'
    | 'message_content'
    | 'condition_type'
    | 'condition_value'
    | 'next_step_on_false'
    | 'offset_days'
    | 'offset_minutes'
    | 'delivery_time'
    | 'template_id'
    | 'on_reach_tag_id'
    | 'after_send'
    | 'target_condition_json'
    | 'question_json'
    | 'is_draft'
  >
>;

export async function updateScenarioStep(
  db: D1Database,
  id: string,
  updates: UpdateScenarioStepInput,
): Promise<ScenarioStep | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.step_order !== undefined) {
    fields.push('step_order = ?');
    values.push(updates.step_order);
  }
  if (updates.delay_minutes !== undefined) {
    fields.push('delay_minutes = ?');
    values.push(updates.delay_minutes);
  }
  if (updates.message_type !== undefined) {
    fields.push('message_type = ?');
    values.push(updates.message_type);
  }
  if (updates.message_content !== undefined) {
    fields.push('message_content = ?');
    values.push(updates.message_content);
  }
  if (updates.condition_type !== undefined) {
    fields.push('condition_type = ?');
    values.push(updates.condition_type);
  }
  if (updates.condition_value !== undefined) {
    fields.push('condition_value = ?');
    values.push(updates.condition_value);
  }
  if (updates.next_step_on_false !== undefined) {
    fields.push('next_step_on_false = ?');
    values.push(updates.next_step_on_false);
  }
  if (updates.offset_days !== undefined) {
    fields.push('offset_days = ?');
    values.push(updates.offset_days);
  }
  if (updates.offset_minutes !== undefined) {
    fields.push('offset_minutes = ?');
    values.push(updates.offset_minutes);
  }
  if (updates.delivery_time !== undefined) {
    fields.push('delivery_time = ?');
    values.push(updates.delivery_time);
  }
  if (updates.template_id !== undefined) {
    fields.push('template_id = ?');
    values.push(updates.template_id);
  }
  if (updates.on_reach_tag_id !== undefined) {
    fields.push('on_reach_tag_id = ?');
    values.push(updates.on_reach_tag_id);
  }
  /*
   * after_send は型には並んでいたが、ここで拾っていなかった。
   * 作成時だけ効いて、編集では黙って捨てられていた（＝画面で
   * 「送信後に一時停止」を外しても元に戻らない）。
   */
  if (updates.after_send !== undefined) {
    fields.push('after_send = ?');
    values.push(updates.after_send);
  }
  if (updates.target_condition_json !== undefined) {
    fields.push('target_condition_json = ?');
    values.push(updates.target_condition_json);
  }
  if (updates.question_json !== undefined) {
    fields.push('question_json = ?');
    values.push(updates.question_json);
  }
  if (updates.is_draft !== undefined) {
    fields.push('is_draft = ?');
    values.push(updates.is_draft);
  }

  if (fields.length > 0) {
    values.push(id);
    await db
      .prepare(`UPDATE scenario_steps SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  return db
    .prepare(`SELECT * FROM scenario_steps WHERE id = ?`)
    .bind(id)
    .first<ScenarioStep>();
}

export async function deleteScenarioStep(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM scenario_steps WHERE id = ?`).bind(id).run();
}

export async function getScenarioSteps(
  db: D1Database,
  scenarioId: string,
): Promise<ScenarioStep[]> {
  const result = await db
    .prepare(
      `SELECT * FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC`,
    )
    .bind(scenarioId)
    .all<ScenarioStep>();
  return result.results;
}

// ============================================================
// Scenario Published Versions (351)
//
// 稼働中の文面・順序を固定する。下書き（scenarios / scenario_steps の
// live 値）は編集し放題で、公開操作だけが不変の版を作る。購読は開始時の
// 版へ固定され、あとの編集は既存配信へ混入しない。
// ============================================================

/**
 * 版に写す通1件ぶん。キーの順序は migration 351 の json_object と同じに
 * する。template を使う通は公開時の文面・質問を解決して写すので、公開後の
 * template 編集は固定済みの版へ混入しない。`id` には版所有の通IDを入れ、
 * live の通IDは live_step_id の控えにだけ残す。
 */
async function buildVersionSnapshotSteps(
  db: D1Database,
  versionId: string,
  steps: ScenarioStep[],
  lineAccountId: string | null,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (const s of steps) {
    // template の解決はシナリオの持ち主アカウントの中だけで行う（#645）。
    // よそのアカウントの template や未公開の template は使わず、通の控えへ
    // 倒す。配信時にはもう templates 表を読まないので、境界の判断はここが
    // 最後の砦になる。
    const resolved = await resolveStepContent(db, s, lineAccountId);
    out.push({
      version_step_id: `${versionId}:${s.step_order}`,
      step_order: s.step_order,
      delay_minutes: s.delay_minutes,
      message_type: resolved.messageType,
      message_content: resolved.messageContent,
      condition_type: s.condition_type,
      condition_value: s.condition_value,
      next_step_on_false: s.next_step_on_false,
      offset_days: s.offset_days,
      offset_minutes: s.offset_minutes,
      delivery_time: s.delivery_time,
      template_id: s.template_id,
      template_id_at_send: resolved.templateIdAtSend,
      on_reach_tag_id: s.on_reach_tag_id,
      after_send: s.after_send,
      target_condition_json: s.target_condition_json,
      question_json: resolved.questionJson,
      is_draft: s.is_draft,
      live_step_id: s.id,
      created_at: s.created_at,
    });
  }
  return out;
}

/**
 * 内容比較用の正規形。版の正体（version_step_id）は同一性の判断から外す。
 * 版IDが決まる前に作った下書きの写しと、保存済みの版の写しを同じ形で
 * 比べられる。live_step_id・created_at は残す（通の差し替えは別内容）。
 */
function normalizeVersionStepSnapshot(
  entry: Record<string, unknown>,
): Record<string, unknown> {
  return {
    step_order: entry['step_order'] ?? null,
    delay_minutes: entry['delay_minutes'] ?? 0,
    message_type: entry['message_type'] ?? 'text',
    message_content: entry['message_content'] ?? '',
    condition_type: entry['condition_type'] ?? null,
    condition_value: entry['condition_value'] ?? null,
    next_step_on_false: entry['next_step_on_false'] ?? null,
    offset_days: entry['offset_days'] ?? null,
    offset_minutes: entry['offset_minutes'] ?? null,
    delivery_time: entry['delivery_time'] ?? null,
    template_id: entry['template_id'] ?? null,
    template_id_at_send: entry['template_id_at_send'] ?? null,
    on_reach_tag_id: entry['on_reach_tag_id'] ?? null,
    after_send: entry['after_send'] ?? 'continue',
    target_condition_json: entry['target_condition_json'] ?? null,
    question_json: entry['question_json'] ?? null,
    is_draft: entry['is_draft'] ?? 0,
    live_step_id: entry['live_step_id'] ?? null,
    created_at: entry['created_at'] ?? null,
  };
}

/**
 * 公開内容の指紋。配信条件と通の写しを1本の文字列にする。同じ文字列なら
 * 同じものが届くので、版の増減と冪等キーの照合はこれで行う。
 */
function canonicalPublishPayload(
  scenario: Pick<
    Scenario,
    'delivery_mode' | 'audience_condition_json' | 'on_complete_mode' | 'on_complete_scenario_id'
  >,
  snapshotSteps: Array<Record<string, unknown>>,
  snapshotActions: Array<Record<string, unknown>>,
): string {
  return JSON.stringify({
    delivery_mode: scenario.delivery_mode ?? 'relative',
    audience_condition_json: scenario.audience_condition_json ?? null,
    on_complete_mode: scenario.on_complete_mode ?? 'pause',
    on_complete_scenario_id: scenario.on_complete_scenario_id ?? null,
    steps: snapshotSteps.map(normalizeVersionStepSnapshot),
    // アクションも指紋に入れる。入れないと「アクションだけ直して公開」が
    // 同内容と判定され、版が増えずに編集が反映されない。
    actions: snapshotActions.map(normalizeVersionActionSnapshot),
  });
}

function canonicalPayloadOfVersion(version: ScenarioVersion): string | null {
  let raw: unknown;
  let rawActions: unknown;
  try {
    raw = JSON.parse(version.steps_snapshot);
    rawActions = JSON.parse(version.actions_snapshot ?? '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || !Array.isArray(rawActions)) return null;
  return canonicalPublishPayload(
    version,
    raw as Array<Record<string, unknown>>,
    rawActions as Array<Record<string, unknown>>,
  );
}

/**
 * 版を1件読む。持ち主のシナリオも必ず付けて読む（364）。よそのシナリオの
 * 版IDを渡されても null に倒し、文面の混入を拒否する。
 */
export async function getScenarioVersionById(
  db: D1Database,
  scenarioId: string,
  versionId: string,
): Promise<ScenarioVersion | null> {
  return db.prepare(`SELECT * FROM scenario_versions WHERE id = ? AND scenario_id = ?`)
    .bind(versionId, scenarioId)
    .first<ScenarioVersion>();
}

export async function getScenarioPublishedVersion(
  db: D1Database,
  scenarioId: string,
): Promise<ScenarioVersion | null> {
  return db.prepare(
    `SELECT sv.*
       FROM scenarios s
       JOIN scenario_versions sv ON sv.id = s.current_published_version_id
      WHERE s.id = ? AND sv.status = 'published'`,
  ).bind(scenarioId).first<ScenarioVersion>();
}

/**
 * 版のスナップショットを通の配列に戻す。通の正体は版所有の通ID。
 * 壊れていたら空にする（呼ぶ側は「通が無い」と同じく購読を完了させる）。
 */
export function parseScenarioVersionSteps(version: ScenarioVersion): PinnedScenarioStep[] {
  let raw: unknown;
  try {
    raw = JSON.parse(version.steps_snapshot);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const steps: PinnedScenarioStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return [];
    const r = item as Record<string, unknown>;
    if (typeof r['version_step_id'] !== 'string' || typeof r['step_order'] !== 'number') return [];
    steps.push({
      id: r['version_step_id'] as string,
      scenario_id: version.scenario_id,
      step_order: r['step_order'] as number,
      delay_minutes: (r['delay_minutes'] as number) ?? 0,
      message_type: (r['message_type'] as ScenarioStep['message_type']) ?? 'text',
      message_content: (r['message_content'] as string) ?? '',
      condition_type: (r['condition_type'] as string | null) ?? null,
      condition_value: (r['condition_value'] as string | null) ?? null,
      next_step_on_false: (r['next_step_on_false'] as number | null) ?? null,
      offset_days: (r['offset_days'] as number | null) ?? null,
      offset_minutes: (r['offset_minutes'] as number | null) ?? null,
      delivery_time: (r['delivery_time'] as string | null) ?? null,
      template_id: (r['template_id'] as string | null) ?? null,
      template_id_at_send: (r['template_id_at_send'] as string | null) ?? null,
      on_reach_tag_id: (r['on_reach_tag_id'] as string | null) ?? null,
      after_send: (r['after_send'] as string) ?? 'continue',
      target_condition_json: (r['target_condition_json'] as string | null) ?? null,
      question_json: (r['question_json'] as string | null) ?? null,
      is_draft: (r['is_draft'] as number) ?? 0,
      live_step_id: (r['live_step_id'] as string | null) ?? null,
      created_at: (r['created_at'] as string) ?? version.created_at,
    });
  }
  return steps;
}

/**
 * 版に写すアクション1件ぶん。キーの順序は migration 351 の json_object と
 * 同じにする。通に紐づくアクションは版所有の通ID（version_step_id）で指す。
 * live の通が消えても、版の中で行き先を見失わない。
 *
 * `action_id` は公開時点の live のアクションID。「2回目以降は実行しない」の
 * 鍵はこれを使う。版IDを鍵に混ぜると、公開のたびに鍵が変わって
 * 「1回だけ」が「版ごとに1回」になってしまう。
 */
async function buildVersionSnapshotActions(
  db: D1Database,
  versionId: string,
  scenarioId: string,
  steps: ScenarioStep[],
): Promise<Array<Record<string, unknown>>> {
  const orderByStepId = new Map<string, number>();
  for (const s of steps) orderByStepId.set(s.id, s.step_order);

  const rows = await db
    .prepare(
      `SELECT id, scenario_id, hook, step_id, choice_index, sort_order,
              action_type, config_json, condition_json, repeat_on_refire
         FROM scenario_actions
        WHERE scenario_id = ?
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(scenarioId)
    .all<ScenarioActionSourceRow>();

  const out: Array<Record<string, unknown>> = [];
  for (const a of rows.results ?? []) {
    // 通に紐づくのに、その通が下書きから消えている行は写さない。行き先の
    // 無いアクションを版に残すと、旧版の購読で永遠に発火しない行が積もる。
    const order = a.step_id === null ? null : orderByStepId.get(a.step_id);
    if (a.step_id !== null && order === undefined) continue;
    out.push({
      version_action_id: `${versionId}#a${a.id}`,
      action_id: a.id,
      hook: a.hook,
      version_step_id: order === null || order === undefined ? null : `${versionId}:${order}`,
      live_step_id: a.step_id,
      choice_index: a.choice_index,
      sort_order: a.sort_order,
      action_type: a.action_type,
      config_json: a.config_json,
      condition_json: a.condition_json,
      repeat_on_refire: a.repeat_on_refire,
    });
  }
  return out;
}

interface ScenarioActionSourceRow {
  id: string;
  scenario_id: string;
  hook: string;
  step_id: string | null;
  choice_index: number | null;
  sort_order: number;
  action_type: string;
  config_json: string;
  condition_json: string | null;
  repeat_on_refire: number;
}

/**
 * 版に固定されたアクション1件。実行側（worker）が読む形。
 * `id` は版所有のアクションID、`action_key` は「1回だけ」の鍵。
 */
export interface PinnedScenarioAction {
  id: string;
  action_key: string;
  scenario_id: string;
  hook: string;
  /** 版所有の通ID。通に紐づかないアクション（完了時など）は null。 */
  version_step_id: string | null;
  live_step_id: string | null;
  choice_index: number | null;
  sort_order: number;
  action_type: string;
  config_json: string;
  condition_json: string | null;
  repeat_on_refire: number;
}

/**
 * 内容比較用の正規形。版の正体（version_action_id）は同一性の判断から外す。
 * 版IDが決まる前に作った下書きの写しと、保存済みの版の写しを同じ形で比べる。
 * version_step_id も版IDを含むので、通番だけを見る形に落とす。
 */
function normalizeVersionActionSnapshot(
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const versionStepId = entry['version_step_id'];
  const stepOrder =
    typeof versionStepId === 'string' && versionStepId.includes(':')
      ? versionStepId.slice(versionStepId.lastIndexOf(':') + 1)
      : null;
  return {
    action_id: entry['action_id'] ?? null,
    hook: entry['hook'] ?? null,
    step_order: stepOrder,
    live_step_id: entry['live_step_id'] ?? null,
    choice_index: entry['choice_index'] ?? null,
    sort_order: entry['sort_order'] ?? 0,
    action_type: entry['action_type'] ?? null,
    config_json: entry['config_json'] ?? null,
    condition_json: entry['condition_json'] ?? null,
    repeat_on_refire: entry['repeat_on_refire'] ?? 1,
  };
}

/**
 * 版のアクションの写しを読み戻す。壊れていたら空にする（アクション無しと
 * 同じ扱い。live へは戻らない）。
 */
export function parseScenarioVersionActions(version: ScenarioVersion): PinnedScenarioAction[] {
  let raw: unknown;
  try {
    raw = JSON.parse(version.actions_snapshot ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const actions: PinnedScenarioAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return [];
    const r = item as Record<string, unknown>;
    if (typeof r['version_action_id'] !== 'string') return [];
    actions.push({
      id: r['version_action_id'] as string,
      action_key: (r['action_id'] as string | null) ?? (r['version_action_id'] as string),
      scenario_id: version.scenario_id,
      hook: (r['hook'] as string) ?? 'step_sent',
      version_step_id: (r['version_step_id'] as string | null) ?? null,
      live_step_id: (r['live_step_id'] as string | null) ?? null,
      choice_index: (r['choice_index'] as number | null) ?? null,
      sort_order: (r['sort_order'] as number) ?? 0,
      action_type: (r['action_type'] as string) ?? '',
      config_json: (r['config_json'] as string) ?? '{}',
      condition_json: (r['condition_json'] as string | null) ?? null,
      repeat_on_refire: (r['repeat_on_refire'] as number) ?? 1,
    });
  }
  return actions;
}

/**
 * 版に固定された通を1件読む。版所有の通ID（`<版ID>:<通番>`）で引く。
 *
 * 質問の回答処理はこれを使う。live の scenario_steps は読まない。押した
 * ときに live を読むと、公開後に直した返信・タグ・遷移が旧版の購読へ
 * 混入する（下書きの通を消したあとは、そもそも引けない）。
 */
export async function getPinnedScenarioStep(
  db: D1Database,
  versionStepId: string,
): Promise<{ version: ScenarioVersion; step: PinnedScenarioStep } | null> {
  const versionId = parseVersionStepId(versionStepId)?.versionId ?? null;
  if (!versionId) return null;
  const version = await db
    .prepare(`SELECT * FROM scenario_versions WHERE id = ?`)
    .bind(versionId)
    .first<ScenarioVersion>();
  if (!version) return null;
  const step = parseScenarioVersionSteps(version).find((s) => s.id === versionStepId);
  if (!step) return null;
  return { version, step };
}

/**
 * 版所有の通ID を版IDと通番に割る。IDは `<版ID>:<通番>` で、版IDは UUID
 * なので、**右端のコロンから後ろだけ**を通番として切る。左から split すると
 * 版IDにコロンが無い前提に寄りかかることになり、形が変わった瞬間に壊れる。
 */
export function parseVersionStepId(
  versionStepId: string,
): { versionId: string; stepOrder: number } | null {
  const at = versionStepId.lastIndexOf(':');
  if (at <= 0 || at === versionStepId.length - 1) return null;
  const versionId = versionStepId.slice(0, at);
  const stepOrder = Number(versionStepId.slice(at + 1));
  if (!Number.isInteger(stepOrder) || stepOrder < 0) return null;
  return { versionId, stepOrder };
}

// ============================================================
// 参照資源のアカウント境界（#644 再審査 3）
//
// テンプレート・タグ・遷移先シナリオを ID だけで読むと、よその LINE 公式
// アカウントの資源をシナリオへ混ぜられる。画面で選べないだけでは足りない
// （API を直接叩ける）ので、実行の直前に server 側で確かめる。
//
// 決まり: シナリオの line_account_id が NULL のときは共通シナリオとして
// 検証しない（従来どおり）。非 NULL のときは、資源側が NULL（共通）か
// 同じアカウントのときだけ通す。他アカウントの資源は使わない。
//
// 移行方針: 既存の不一致は migration で消さない（黙って運用が壊れる）。
// 実行時に拒否して警告を残し、次に公開した版の写しから外れていく。既存の
// 不一致は findScenarioReferenceMismatches で洗い出せる。
// ============================================================

/** アカウントで区切られる参照資源の種類。 */
export type AccountScopedResource = 'tag' | 'template' | 'scenario';

const ACCOUNT_SCOPED_TABLES: Record<AccountScopedResource, string> = {
  tag: 'tags',
  template: 'templates',
  scenario: 'scenarios',
};

/**
 * 参照資源が、そのシナリオと同じ LINE 公式アカウントのものか。
 *
 * - シナリオ側が共通（NULL）なら確かめない → true
 * - 資源が見つからないときは false（消された ID を黙って使わない）
 * - 資源側が共通（NULL）なら true
 */
export async function isResourceInScenarioAccount(
  db: D1Database,
  resource: AccountScopedResource,
  resourceId: string | null | undefined,
  scenarioAccountId: string | null,
): Promise<boolean> {
  if (!resourceId) return true;
  if (!scenarioAccountId) return true;
  const table = ACCOUNT_SCOPED_TABLES[resource];
  const row = await db
    .prepare(`SELECT line_account_id AS account_id FROM ${table} WHERE id = ?`)
    .bind(resourceId)
    .first<{ account_id: string | null }>();
  if (!row) return false;
  return row.account_id === null || row.account_id === scenarioAccountId;
}

export interface ScenarioReferenceMismatch {
  scenarioId: string;
  scenarioAccountId: string | null;
  resource: AccountScopedResource;
  resourceId: string;
  resourceAccountId: string | null;
  /** どこから参照しているか（通・アクション・シナリオ本体）。 */
  origin: string;
}

/**
 * いま保存されている参照のうち、シナリオと別アカウントのものを洗い出す。
 *
 * 移行で消さない代わりに、運用が既存の不一致を一覧で確かめられるようにする。
 * 通の本文テンプレート・到達タグ・完了時の遷移先・アクションのタグと
 * テンプレートと遷移先を見る。
 */
export async function findScenarioReferenceMismatches(
  db: D1Database,
  scenarioId?: string,
): Promise<ScenarioReferenceMismatch[]> {
  const scenarios = scenarioId
    ? await db
        .prepare(`SELECT id, line_account_id FROM scenarios WHERE id = ?`)
        .bind(scenarioId)
        .all<{ id: string; line_account_id: string | null }>()
    : await db
        .prepare(`SELECT id, line_account_id FROM scenarios WHERE line_account_id IS NOT NULL`)
        .all<{ id: string; line_account_id: string | null }>();

  const out: ScenarioReferenceMismatch[] = [];
  for (const s of scenarios.results ?? []) {
    if (!s.line_account_id) continue;
    const check = async (
      resource: AccountScopedResource,
      resourceId: string | null,
      origin: string,
    ): Promise<void> => {
      if (!resourceId) return;
      if (await isResourceInScenarioAccount(db, resource, resourceId, s.line_account_id)) return;
      const row = await db
        .prepare(
          `SELECT line_account_id AS account_id FROM ${ACCOUNT_SCOPED_TABLES[resource]} WHERE id = ?`,
        )
        .bind(resourceId)
        .first<{ account_id: string | null }>();
      out.push({
        scenarioId: s.id,
        scenarioAccountId: s.line_account_id,
        resource,
        resourceId,
        resourceAccountId: row?.account_id ?? null,
        origin,
      });
    };

    const scenarioRow = await db
      .prepare(`SELECT on_complete_scenario_id FROM scenarios WHERE id = ?`)
      .bind(s.id)
      .first<{ on_complete_scenario_id: string | null }>();
    await check('scenario', scenarioRow?.on_complete_scenario_id ?? null, 'scenario.on_complete');

    const steps = await db
      .prepare(`SELECT id, template_id, on_reach_tag_id FROM scenario_steps WHERE scenario_id = ?`)
      .bind(s.id)
      .all<{ id: string; template_id: string | null; on_reach_tag_id: string | null }>();
    for (const step of steps.results ?? []) {
      await check('template', step.template_id, `step:${step.id}.template`);
      await check('tag', step.on_reach_tag_id, `step:${step.id}.on_reach_tag`);
    }

    const actions = await db
      .prepare(`SELECT id, action_type, config_json FROM scenario_actions WHERE scenario_id = ?`)
      .bind(s.id)
      .all<{ id: string; action_type: string; config_json: string }>();
    for (const action of actions.results ?? []) {
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(action.config_json) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (action.action_type === 'tag' && Array.isArray(config['tagIds'])) {
        for (const tagId of config['tagIds'] as unknown[]) {
          if (typeof tagId === 'string') await check('tag', tagId, `action:${action.id}.tag`);
        }
      }
      if (action.action_type === 'send_template' && typeof config['templateId'] === 'string') {
        await check('template', config['templateId'] as string, `action:${action.id}.template`);
      }
      if (action.action_type === 'scenario' && typeof config['scenarioId'] === 'string') {
        await check('scenario', config['scenarioId'] as string, `action:${action.id}.scenario`);
      }
    }
  }
  return out;
}

/**
 * 公開 batch が制約で巻き戻ったときの分類。版番号の UNIQUE 違反は同時公開
 * の競合（取り直す）。キー台帳の PRIMARY KEY 違反はキーの競合（読み直して
 * 同内容ならその版、別内容なら 409）。どちらでも書いた分は残らない。
 */
function classifyPublishBatchError(error: unknown): 'version-number' | 'idempotency-key' | 'unknown' {
  const message = error instanceof Error ? error.message : String(error);
  if (/scenario_publish_keys/i.test(message)) return 'idempotency-key';
  if (/scenario_versions/i.test(message)) return 'version-number';
  return 'unknown';
}

/**
 * いまの下書きを公開版として固定する。単一原子 protocol。
 *
 * - 書き込み前の判定では何も書かない。同キーの再実行は同版を返し、
 *   別内容・別シナリオの使い回しは SCENARIO_PUBLISH_KEY_CONFLICT（409）。
 * - 書き込みは1回の batch にまとめる（版INSERT・指針・旧版引退・キー予約）。
 *   D1 の batch は原子なので、失敗したら指針だけ進む・版だけ残る・キーの
 *   だけ残る、の途中状態を作らない。CAS の敗者版も残らない。
 * - 同時公開の競合は制約違反で検出する。版番号の重なりは期待値（版番号・
 *   指針・キー台帳）を取り直して再試行し（最大5回）、キーの重なりは
 *   残っている行を読み直して同内容ならその版・別内容なら 409 にする。
 * - 内容が現行の公開版と同じなら版を増やさず、キーだけ残して現行版を返す。
 */
export async function publishScenarioVersion(
  db: D1Database,
  scenarioId: string,
  input: { staffId: string | null; idempotencyKey: string },
): Promise<ScenarioVersion> {
  const scenario = await db.prepare(`SELECT * FROM scenarios WHERE id = ?`)
    .bind(scenarioId)
    .first<Scenario>();
  if (!scenario) throw new Error('SCENARIO_NOT_FOUND');

  const steps = await getScenarioSteps(db, scenarioId);
  const draftSteps = await buildVersionSnapshotSteps(db, '', steps, scenario.line_account_id ?? null);
  const draftActions = await buildVersionSnapshotActions(db, '', scenarioId, steps);
  const draftPayload = canonicalPublishPayload(scenario, draftSteps, draftActions);

  // 同じキーの再実行・使い回しの判定。ここでは何も書かないので、409 の
  // 経路で公開側の状態は変わらない。
  const replay = await db.prepare(
    `SELECT * FROM scenario_publish_keys WHERE publish_idempotency_key = ?`,
  ).bind(input.idempotencyKey).first<ScenarioPublishKey>();
  if (replay) {
    if (replay.scenario_id !== scenarioId || replay.content_snapshot !== draftPayload) {
      throw new Error('SCENARIO_PUBLISH_KEY_CONFLICT');
    }
    const replayed = await getScenarioVersionById(db, scenarioId, replay.version_id);
    if (!replayed) throw new Error('SCENARIO_NOT_PUBLISHED');
    return replayed;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    // 期待値の再読込。毎回いまの指針と版番号を取り直す。
    const current = await getScenarioPublishedVersion(db, scenarioId);
    if (current && canonicalPayloadOfVersion(current) === draftPayload) {
      await db.batch([
        db.prepare(
          `INSERT OR IGNORE INTO scenario_publish_keys
             (publish_idempotency_key, scenario_id, version_id, content_snapshot, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(input.idempotencyKey, scenarioId, current.id, draftPayload, jstNow()),
      ]);
      const row = await db.prepare(
        `SELECT * FROM scenario_publish_keys WHERE publish_idempotency_key = ?`,
      ).bind(input.idempotencyKey).first<ScenarioPublishKey>();
      if (!row || row.scenario_id !== scenarioId || row.content_snapshot !== draftPayload) {
        throw new Error('SCENARIO_PUBLISH_KEY_CONFLICT');
      }
      const version = await getScenarioVersionById(db, scenarioId, row.version_id);
      if (!version) throw new Error('SCENARIO_NOT_PUBLISHED');
      return version;
    }

    const next = await db.prepare(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
         FROM scenario_versions WHERE scenario_id = ?`,
    ).bind(scenarioId).first<{ version_number: number }>();
    const versionNumber = Number(next?.version_number ?? 1);
    const id = crypto.randomUUID();
    const snapshotSteps = await buildVersionSnapshotSteps(db, id, steps, scenario.line_account_id ?? null);
    const snapshotActions = await buildVersionSnapshotActions(db, id, scenarioId, steps);
    const now = jstNow();
    try {
      // 単一原子。INSERT は素直な形にし、競合は制約違反で検出する
      // （OR IGNORE で飲むと、書けた分だけ残る分離実行に戻る）。
      await db.batch([
        db.prepare(
          `INSERT INTO scenario_versions
             (id, scenario_id, version_number, delivery_mode, audience_condition_json,
              on_complete_mode, on_complete_scenario_id, steps_snapshot, actions_snapshot,
              status, published_at, published_by_staff_id,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)`,
        ).bind(
          id,
          scenarioId,
          versionNumber,
          scenario.delivery_mode ?? 'relative',
          scenario.audience_condition_json ?? null,
          scenario.on_complete_mode ?? 'pause',
          scenario.on_complete_scenario_id ?? null,
          JSON.stringify(snapshotSteps),
          JSON.stringify(snapshotActions),
          now,
          input.staffId,
          now,
          now,
        ),
        db.prepare(
          `UPDATE scenarios SET current_published_version_id = ?, updated_at = ?
            WHERE id = ?`,
        ).bind(id, now, scenarioId),
        db.prepare(
          `UPDATE scenario_versions SET status = 'retired', updated_at = ?
            WHERE scenario_id = ? AND status = 'published' AND id != ?`,
        ).bind(now, scenarioId, id),
        db.prepare(
          `INSERT INTO scenario_publish_keys
             (publish_idempotency_key, scenario_id, version_id, content_snapshot, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(input.idempotencyKey, scenarioId, id, draftPayload, now),
      ]);
    } catch (error) {
      const kind = classifyPublishBatchError(error);
      if (kind === 'idempotency-key') {
        // 同じキーを誰かが先に残した。batch は巻き戻っているので版の残骸は
        // ない。残っている行を読み直して同内容ならその版、別内容なら 409。
        const row = await db.prepare(
          `SELECT * FROM scenario_publish_keys WHERE publish_idempotency_key = ?`,
        ).bind(input.idempotencyKey).first<ScenarioPublishKey>();
        if (row && row.scenario_id === scenarioId && row.content_snapshot === draftPayload) {
          const version = await getScenarioVersionById(db, scenarioId, row.version_id);
          if (version) return version;
        }
        throw new Error('SCENARIO_PUBLISH_KEY_CONFLICT');
      }
      if (kind === 'version-number') continue;
      throw error;
    }
    const saved = await getScenarioVersionById(db, scenarioId, id);
    if (!saved || saved.status !== 'published') throw new Error('SCENARIO_NOT_PUBLISHED');
    return saved;
  }
  throw new Error('SCENARIO_PUBLISH_CONFLICT');
}

export interface ScenarioDeliverySource {
  deliveryMode: DeliveryMode;
  audienceConditionJson: string | null;
  onCompleteMode: string | null;
  onCompleteScenarioId: string | null;
  steps: PinnedScenarioStep[];
  /** 版に固定されたアクション設定。実行はこの写しから行う。 */
  actions: PinnedScenarioAction[];
  /** 購読開始時に固定した公開版。配信はこの版だけを読む。 */
  pinnedVersionId: string;
}

/**
 * 配信が読む通と条件を1箇所で決める。購読に固定された公開版だけを読む。
 *
 * 版が無い（未公開）・版の行が見つからない（欠損参照）ときは null を返す。
 * live の下書き表へは戻らない。呼ぶ側は送らずに止める（購読の一時停止・
 * 再開の見送り）。下書きの編集中身が配信へ混入しないための安全停止。
 */
export async function getStepsForDelivery(
  db: D1Database,
  scenarioId: string,
  publishedVersionId: string | null,
): Promise<ScenarioDeliverySource | null> {
  if (!publishedVersionId) return null;
  const version = await db.prepare(
    `SELECT * FROM scenario_versions WHERE id = ? AND scenario_id = ?`,
  ).bind(publishedVersionId, scenarioId).first<ScenarioVersion>();
  if (!version) return null;
  return {
    deliveryMode: (version.delivery_mode ?? 'relative') as DeliveryMode,
    audienceConditionJson: version.audience_condition_json ?? null,
    onCompleteMode: version.on_complete_mode ?? null,
    onCompleteScenarioId: version.on_complete_scenario_id ?? null,
    steps: parseScenarioVersionSteps(version),
    actions: parseScenarioVersionActions(version),
    pinnedVersionId: version.id,
  };
}

/**
 * live の通がまだ残っているか。配信ログの scenario_step_id には、残って
 * いるときだけ live の通IDを入れ、消されたあとは NULL にする（外部キー
 * を壊さない）。ダッシュボードの集計は残っている分だけ付く。
 */
export async function scenarioStepExists(db: D1Database, stepId: string | null): Promise<boolean> {
  if (!stepId) return false;
  const row = await db.prepare(`SELECT 1 AS ok FROM scenario_steps WHERE id = ?`)
    .bind(stepId)
    .first<{ ok: number }>();
  return row !== null;
}

// ============================================================
// Friend Scenario Enrollments
// ============================================================

export async function enrollFriendInScenario(
  db: D1Database,
  friendId: string,
  scenarioId: string,
  sourceEnrollmentId?: string,
): Promise<FriendScenario | null> {
  const id = sourceEnrollmentId ?? crypto.randomUUID();
  if (sourceEnrollmentId) {
    const previous = await db.prepare(`SELECT * FROM friend_scenarios WHERE id=? AND friend_id=? AND scenario_id=?`)
      .bind(id, friendId, scenarioId).first<FriendScenario>();
    if (previous) return previous;
  }
  const now = jstNow();

  // delivery_mode を取得（migration 037 適用前の DB では 'relative' が DEFAULT で既に入っている）
  const scenarioRow = await db
    .prepare(`SELECT delivery_mode, allow_concurrent, is_active FROM scenarios WHERE id = ?`)
    .bind(scenarioId)
    .first<{ delivery_mode: DeliveryMode; allow_concurrent: number | null; is_active: number }>();
  if (!scenarioRow) return null;

  // 止めているシナリオは受け付けない。cron も止めたシナリオには配らないので、
  // ここで購読だけ作ると「入ったのに届かない」行が残る。
  if (scenarioRow.is_active === 0) return null;

  // 重複は副作用の前に弾く。版の読み・予定計算の前に返すので、重複登録の
  // たびに公開側の状態を触らない。
  //
  // null を返す。例外にしないのは、呼び出し口が「友だち追加」や
  // 「タグが付いた」といった副作用の中にあり、そこで throw すると
  // 本来の処理まで巻き添えで失敗するため。
  const duplicate = await db
    .prepare(
      `SELECT id FROM friend_scenarios
        WHERE friend_id = ? AND scenario_id = ? AND status != 'completed'
        LIMIT 1`,
    )
    .bind(friendId, scenarioId)
    .first<{ id: string }>();
  if (duplicate) return null;

  // 並行を許さないシナリオは、他のシナリオが動いている人には登録しない。
  //
  // 既定は「許す」（104 で既存の行を 1 に寄せ、作成時も 1 を渡す）。
  // ここを既定で塞ぐと、いま複数のシナリオに入っている人への配信が
  // 止まってしまう。止めたい人だけが画面から 0 にする。
  //
  // 同じシナリオへの二重登録は、上の重複検査と部分UNIQUE索引が防いでいる
  // （idx_friend_scenarios_unique）。ここで見るのは「他のシナリオ」だけ。
  if (scenarioRow.allow_concurrent === 0) {
    const other = await db
      .prepare(
        `SELECT 1 FROM friend_scenarios
          WHERE friend_id = ? AND scenario_id != ? AND status = 'active'
          LIMIT 1`,
      )
      .bind(friendId, scenarioId)
      .first<{ 1: number }>();
    if (other) return null;
  }

  // 開始時の公開版へ固定する（351）。明示公開された版だけを選び、未公開の
  // 下書きを自動公開しない。未公開のときは受け付けない（null）。
  const version = await getScenarioPublishedVersion(db, scenarioId);
  if (!version) return null;
  const pinnedSteps = parseScenarioVersionSteps(version).filter((s) => (s.is_draft ?? 0) === 0);
  const firstStep = pinnedSteps.length > 0 ? pinnedSteps[0] : null;

  // A scenario with no steps is immediately completed — no stuck active enrollment.
  if (!firstStep) {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, published_version_id, updated_at)
         VALUES (?, ?, ?, 0, 'completed', ?, NULL, ?, ?)`,
      )
      .bind(id, friendId, scenarioId, now, version.id, now)
      .run();

    if (!result.meta.changes || result.meta.changes === 0) return null;

    return (await db
      .prepare(`SELECT * FROM friend_scenarios WHERE id = ?`)
      .bind(id)
      .first<FriendScenario>())!;
  }

  const enrolledAtDate = new Date(Date.now() + 9 * 60 * 60_000);
  // 予定の組み立ては固定した版の値で行う。開始後に配信方式を変えても、
  // 既存の購読の予定は変わらない。
  const nextDeliveryDate = computeNextDeliveryAt(
    { delivery_mode: (version.delivery_mode ?? 'relative') as DeliveryMode },
    firstStep,
    { enrolledAt: enrolledAtDate, previousDeliveredAt: enrolledAtDate, now: enrolledAtDate },
  );
  const nextDeliveryAt = nextDeliveryDate.toISOString().slice(0, -1) + '+09:00';

  // current_step_order is initialized to -1 (NOT 0) so that the step-delivery
  // service's `steps.find(s => s.step_order > fs.current_step_order)` lookup
  // matches the very first step (step_order=0).
  // If we initialize to 0, scenarios that only have a step_order=0 step are
  // silently completed without delivering anything (because no step has
  // step_order > 0). This was observed in production on 2026-04-27 where
  // ~10 friend_scenarios silently completed for a 46-hour window.
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, published_version_id, updated_at)
       VALUES (?, ?, ?, -1, 'active', ?, ?, ?, ?)`,
    )
    .bind(id, friendId, scenarioId, now, nextDeliveryAt, version.id, now)
    .run();

  if (!result.meta.changes || result.meta.changes === 0) return null;

  return (await db
    .prepare(`SELECT * FROM friend_scenarios WHERE id = ?`)
    .bind(id)
    .first<FriendScenario>())!;
}

export async function getFriendScenariosDueForDelivery(
  db: D1Database,
  now: string,
  limit = SCENARIO_DELIVERY_BATCH_LIMIT,
  scenarioId?: string,
): Promise<FriendScenario[]> {
  const dueBefore = normalizeScenarioDeliveryTimestamp(now);
  if (dueBefore === null) throw new Error(`Invalid due-delivery timestamp: ${now}`);
  const batchLimit = Math.max(1, Math.floor(limit));
  const query = buildFriendScenariosDueForDeliveryQuery(scenarioId !== undefined);
  const result = await db
    .prepare(query)
    .bind(...(scenarioId === undefined
      ? [dueBefore, batchLimit]
      : [dueBefore, scenarioId, batchLimit]))
    .all<FriendScenario>();
  return result.results;
}

/**
 * Optimistic lock: claim a friend_scenario for delivery.
 * Only succeeds if status='active' and current_step_order matches.
 * Returns true if claimed, false if another worker already processed it.
 */
export async function claimFriendScenarioForDelivery(
  db: D1Database,
  id: string,
  expectedStepOrder: number,
): Promise<boolean> {
  const now = jstNow();
  const result = await db
    .prepare(
      `UPDATE friend_scenarios
       SET status = 'delivering', updated_at = ?
       WHERE id = ? AND status = 'active' AND current_step_order = ?`,
    )
    .bind(now, id, expectedStepOrder)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Crash recovery: reset friend_scenarios stuck in 'delivering' for over 5 minutes back to 'active'.
 */
export async function recoverStuckDeliveries(db: D1Database): Promise<number> {
  const fiveMinAgo = new Date(Date.now() + 9 * 60 * 60_000 - 5 * 60_000);
  const threshold = fiveMinAgo.toISOString().slice(0, -1) + '+09:00';
  // 機能オフ中のアカウントの行は回収しない。OFF中は status も updated_at も
  // 動かさず delivering のまま残し、再オンの tick で回収する。
  const result = await db
    .prepare(
      `UPDATE friend_scenarios SET status = 'active', updated_at = ?
       WHERE status = 'delivering' AND updated_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM scenarios s
            WHERE s.id = friend_scenarios.scenario_id
              AND ${accountFeatureOffExclusionSql('s.line_account_id', 'scenarios')}
         )`,
    )
    .bind(jstNow(), threshold)
    .run();
  return result.meta.changes ?? 0;
}

/**
 * Stop a claimed delivery without losing its enrollment state.
 * Used for permanent recipient/payload failures and for account-bound
 * scenarios that do not have a safe destination friend for that account.
 */
export async function pauseFriendScenarioDelivery(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE friend_scenarios SET status = 'paused', updated_at = ?
       WHERE id = ? AND status = 'delivering'`,
    )
    .bind(jstNow(), id)
    .run();
}

export async function advanceFriendScenario(
  db: D1Database,
  id: string,
  nextStepOrder: number,
  nextDeliveryAt?: string | null,
): Promise<void> {
  const now = jstNow();
  const normalizedNextDeliveryAt = nextDeliveryAt
    ? normalizeScenarioDeliveryTimestamp(nextDeliveryAt)
    : null;
  if (nextDeliveryAt && normalizedNextDeliveryAt === null) {
    throw new Error(`Invalid scenario delivery timestamp: ${nextDeliveryAt}`);
  }
  await db
    .prepare(
      `UPDATE friend_scenarios
       SET current_step_order = ?,
           next_delivery_at = ?,
           status = 'active',
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextStepOrder, normalizedNextDeliveryAt, now, id)
    .run();
}

/**
 * 送ったところで止める。
 *
 * 「送信後 一時停止」が付いた通を送ったあとに呼ぶ。次の配信日時を消して
 * status を paused にするので、時間が来ても勝手には進まない。人が再開すると
 * 止まった続きから流れる（current_step_order はそのまま残す）。
 */
export async function pauseFriendScenario(
  db: D1Database,
  id: string,
  atStepOrder: number,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE friend_scenarios
       SET status = 'paused',
           current_step_order = ?,
           next_delivery_at = NULL,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(atStepOrder, now, id)
    .run();
}

export async function completeFriendScenario(
  db: D1Database,
  id: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE friend_scenarios
       SET status = 'completed',
           next_delivery_at = NULL,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, id)
    .run();
}

/**
 * 前回読んだところから、同じシナリオを再開する（設計 V2 4-6「開始位置」）。
 *
 * `enrollFriendInScenario` は必ず `current_step_order = -1` の新しい行を作るので、
 * ブロックを解除した人にもう一度1通目から流れてしまう。ここは既にある行を
 * 生かして、続きから配信する。
 *
 * 進める先が無い（最後まで読み終えている）ときは `null` を返す。呼ぶ側で
 * 「送るものが無い」として扱う。既にある行が `active` のときも `null`
 * （もう流れているので、触ると二重配信になる）。
 */
export async function resumeFriendScenario(
  db: D1Database,
  friendId: string,
  scenarioId: string,
): Promise<FriendScenario | null> {
  const existing = await db
    .prepare(
      `SELECT * FROM friend_scenarios
        WHERE friend_id = ? AND scenario_id = ?
        ORDER BY started_at DESC
        LIMIT 1`,
    )
    .bind(friendId, scenarioId)
    .first<FriendScenario>();
  if (!existing) return null;
  if (existing.status === 'active' || existing.status === 'delivering') return null;

  // 止めているシナリオは再開しない。起こすと cron が拾って配り始める。
  const scenarioState = await db.prepare(`SELECT is_active FROM scenarios WHERE id = ?`)
    .bind(scenarioId)
    .first<{ is_active: number }>();
  if (!scenarioState || scenarioState.is_active === 0) return null;

  // 固定した版だけから次を探す（351）。版が無い・欠損しているときは
  // live の表へ戻らず見送る（null）。
  const source = await getStepsForDelivery(db, scenarioId, existing.published_version_id ?? null);
  if (!source) return null;
  const nextStep = source.steps.find(s => s.step_order > existing.current_step_order);
  if (!nextStep) return null;

  const nowDate = new Date(Date.now() + 9 * 60 * 60_000);
  const nextDeliveryDate = computeNextDeliveryAt(
    { delivery_mode: source.deliveryMode },
    nextStep,
    { enrolledAt: nowDate, previousDeliveredAt: nowDate, now: nowDate },
  );
  const nextDeliveryAt = nextDeliveryDate.toISOString().slice(0, -1) + '+09:00';
  const now = jstNow();

  await db
    .prepare(
      `UPDATE friend_scenarios
          SET status = 'active', next_delivery_at = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(nextDeliveryAt, now, existing.id)
    .run();

  return (await db
    .prepare(`SELECT * FROM friend_scenarios WHERE id = ?`)
    .bind(existing.id)
    .first<FriendScenario>())!;
}
