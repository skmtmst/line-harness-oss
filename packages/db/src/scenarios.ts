import { jstNow } from './utils.js';
import { computeNextDeliveryAt } from './scenario-schedule.js';
export type ScenarioTriggerType = 'friend_add' | 'tag_added' | 'manual';
export type MessageType = 'text' | 'image' | 'flex';
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
  updated_at: string;
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
    'name' | 'description' | 'trigger_type' | 'trigger_tag_id' | 'is_active' | 'allow_concurrent'
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

export async function deleteScenario(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM scenarios WHERE id = ?`).bind(id).run();
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
        created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
// Friend Scenario Enrollments
// ============================================================

export async function enrollFriendInScenario(
  db: D1Database,
  friendId: string,
  scenarioId: string,
): Promise<FriendScenario | null> {
  const id = crypto.randomUUID();
  const now = jstNow();

  // delivery_mode を取得（migration 037 適用前の DB では 'relative' が DEFAULT で既に入っている）
  const scenarioRow = await db
    .prepare(`SELECT delivery_mode, allow_concurrent FROM scenarios WHERE id = ?`)
    .bind(scenarioId)
    .first<{ delivery_mode: DeliveryMode; allow_concurrent: number | null }>();
  if (!scenarioRow) return null;

  // 並行を許さないシナリオは、他のシナリオが動いている人には登録しない。
  //
  // 既定は「許す」（104 で既存の行を 1 に寄せ、作成時も 1 を渡す）。
  // ここを既定で塞ぐと、いま複数のシナリオに入っている人への配信が
  // 止まってしまう。止めたい人だけが画面から 0 にする。
  //
  // 同じシナリオへの二重登録は、これとは別に部分UNIQUE索引が防いでいる
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
    // null を返す。例外にしないのは、呼び出し口が「友だち追加」や
    // 「タグが付いた」といった副作用の中にあり、そこで throw すると
    // 本来の処理まで巻き添えで失敗するため。
    if (other) return null;
  }

  const firstStep = await db
    .prepare(
      `SELECT step_order, delay_minutes, offset_days, offset_minutes, delivery_time
       FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC LIMIT 1`,
    )
    .bind(scenarioId)
    .first<{
      step_order: number;
      delay_minutes: number;
      offset_days: number | null;
      offset_minutes: number | null;
      delivery_time: string | null;
    }>();

  // A scenario with no steps is immediately completed — no stuck active enrollment.
  if (!firstStep) {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, updated_at)
         VALUES (?, ?, ?, 0, 'completed', ?, NULL, ?)`,
      )
      .bind(id, friendId, scenarioId, now, now)
      .run();

    if (!result.meta.changes || result.meta.changes === 0) return null;

    return (await db
      .prepare(`SELECT * FROM friend_scenarios WHERE id = ?`)
      .bind(id)
      .first<FriendScenario>())!;
  }

  const enrolledAtDate = new Date(Date.now() + 9 * 60 * 60_000);
  const nextDeliveryDate = computeNextDeliveryAt(
    { delivery_mode: scenarioRow.delivery_mode },
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
      `INSERT OR IGNORE INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, updated_at)
       VALUES (?, ?, ?, -1, 'active', ?, ?, ?)`,
    )
    .bind(id, friendId, scenarioId, now, nextDeliveryAt, now)
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
): Promise<FriendScenario[]> {
  // Fetch all active scenarios with a delivery time, then filter by epoch comparison
  // to handle mixed timestamp formats (Z and +09:00) during migration
  const result = await db
    .prepare(
      `SELECT fs.* FROM friend_scenarios fs
       INNER JOIN scenarios s ON fs.scenario_id = s.id
       WHERE fs.status = 'active'
         AND s.is_active = 1
         AND fs.next_delivery_at IS NOT NULL`,
    )
    .all<FriendScenario>();
  const nowMs = new Date(now).getTime();
  return result.results
    .filter((fs) => new Date(fs.next_delivery_at!).getTime() <= nowMs)
    .sort((a, b) => new Date(a.next_delivery_at!).getTime() - new Date(b.next_delivery_at!).getTime());
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
  const result = await db
    .prepare(
      `UPDATE friend_scenarios SET status = 'active', updated_at = ?
       WHERE status = 'delivering' AND updated_at < ?`,
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
  await db
    .prepare(
      `UPDATE friend_scenarios
       SET current_step_order = ?,
           next_delivery_at = ?,
           status = 'active',
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextStepOrder, nextDeliveryAt ?? null, now, id)
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

  const scenarioRow = await db
    .prepare(`SELECT delivery_mode FROM scenarios WHERE id = ?`)
    .bind(scenarioId)
    .first<{ delivery_mode: DeliveryMode }>();
  if (!scenarioRow) return null;

  const steps = await getScenarioSteps(db, scenarioId);
  const nextStep = steps.find(s => s.step_order > existing.current_step_order);
  if (!nextStep) return null;

  const nowDate = new Date(Date.now() + 9 * 60 * 60_000);
  const nextDeliveryDate = computeNextDeliveryAt(
    { delivery_mode: scenarioRow.delivery_mode },
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
