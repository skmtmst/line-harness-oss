import { Hono } from 'hono';
import {
  getScenarios,
  getScenarioById,
  createScenario,
  updateScenario,
  deleteScenario,
  createScenarioStep,
  updateScenarioStep,
  deleteScenarioStep,
  enrollFriendInScenario,
  getFriendById,
  computeNextDeliveryAt,
} from '@line-crm/db';
import { reorderScenarios } from '@line-crm/db';
import { computeScenarioStats } from '../services/scenario-stats.js';
import { SUPPORTED_CONDITION_TYPES, isSupportedConditionType } from '../services/step-delivery.js';
import { resolveStepContent } from '@line-crm/db';
import type {
  Scenario as DbScenario,
  ScenarioWithStepCount as DbScenarioWithStepCount,
  ScenarioStep as DbScenarioStep,
  FriendScenario as DbFriendScenario,
  ScenarioTriggerType,
  MessageType,
  DeliveryMode,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

const scenarios = new Hono<Env>();

/** Convert D1 snake_case Scenario row to shared camelCase shape */
function serializeScenario(row: DbScenario) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerType: row.trigger_type,
    triggerTagId: row.trigger_tag_id,
    // null = global scenario (fires for every account); UUID = bound to that line_account_id.
    // Surfacing this lets the dashboard distinguish "全アカ共通" from orphan scenarios whose
    // owner account was deleted.
    lineAccountId: (row as { line_account_id?: string | null }).line_account_id ?? null,
    isActive: Boolean(row.is_active),
    deliveryMode: (row.delivery_mode ?? 'relative') as DeliveryMode,
    // 既定は「並行を許す」。104 で既存の行を 1 に寄せてある。
    allowConcurrent: (row.allow_concurrent ?? 1) !== 0,
    displayOrder: Number(row.display_order ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Convert D1 snake_case ScenarioStep row to shared camelCase shape */
function serializeStep(row: DbScenarioStep) {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    stepOrder: row.step_order,
    delayMinutes: row.delay_minutes,
    offsetDays: row.offset_days ?? null,
    offsetMinutes: row.offset_minutes ?? null,
    deliveryTime: row.delivery_time ?? null,
    messageType: row.message_type,
    messageContent: row.message_content,
    conditionType: row.condition_type ?? null,
    conditionValue: row.condition_value ?? null,
    nextStepOnFalse: row.next_step_on_false ?? null,
    templateId: row.template_id ?? null,
    onReachTagId: row.on_reach_tag_id ?? null,
    // この通を送ったあと。'pause' なら次へ進めず止める。列が無い環境でも
    // 'continue'（これまでの動き）として返す。
    afterSend: (row.after_send ?? 'continue') as 'continue' | 'pause',
    createdAt: row.created_at,
  };
}

const VALID_DELIVERY_MODES: readonly DeliveryMode[] = ['relative', 'elapsed', 'absolute_time'];
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validate scenario step condition_type / condition_value pair.
 * Rejects unknown condition_type values up-front (write-time) so users get an
 * actionable error instead of the silent over-delivery seen in OSS issue #120.
 */
function validateStepCondition(
  conditionType: unknown,
  conditionValue: unknown,
): { ok: true } | { ok: false; error: string } {
  if (conditionType == null || conditionType === '') return { ok: true };
  if (!isSupportedConditionType(conditionType)) {
    return {
      ok: false,
      error: `Unsupported conditionType "${String(conditionType)}" (supported: ${SUPPORTED_CONDITION_TYPES.join(', ')})`,
    };
  }
  // conditionType が「あり」のとき conditionValue は必ず非空文字列。
  // body の TS 型は実行時には強制されないので、明示的に runtime check しないと
  // 数値・オブジェクトが SQL バインドに乗って 0件マッチ → tag_not_exists が全友だちに当たる、
  // のような OSS issue #120 と同じ over-delivery を再現してしまう。
  if (typeof conditionValue !== 'string' || conditionValue === '') {
    return { ok: false, error: 'conditionValue must be a non-empty string when conditionType is set' };
  }
  if (conditionType === 'metadata_equals' || conditionType === 'metadata_not_equals') {
    try {
      const parsed = JSON.parse(conditionValue) as unknown;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        typeof (parsed as { key?: unknown }).key !== 'string' ||
        !('value' in (parsed as Record<string, unknown>))
      ) {
        return { ok: false, error: 'conditionValue for metadata_* must be JSON {"key": "...", "value": ...}' };
      }
    } catch {
      return { ok: false, error: 'conditionValue for metadata_* must be valid JSON' };
    }
  }
  return { ok: true };
}

interface StepScheduleBody {
  delayMinutes?: number;
  offsetDays?: number;
  offsetMinutes?: number;
  deliveryTime?: string;
}

/** delivery_mode に応じてスケジュールフィールドを検証する。 */
function validateStepSchedule(
  mode: DeliveryMode,
  body: StepScheduleBody,
): { ok: true } | { ok: false; error: string } {
  if (mode === 'relative') {
    if (body.offsetDays != null || body.offsetMinutes != null || body.deliveryTime != null) {
      return { ok: false, error: 'relative mode: only delayMinutes is allowed' };
    }
    if (typeof body.delayMinutes !== 'number' || body.delayMinutes < 0) {
      return { ok: false, error: 'relative mode: delayMinutes (>=0) is required' };
    }
    return { ok: true };
  }
  if (mode === 'elapsed') {
    if (body.delayMinutes != null || body.deliveryTime != null) {
      return { ok: false, error: 'elapsed mode: only offsetDays + offsetMinutes are allowed' };
    }
    if (typeof body.offsetDays !== 'number' || body.offsetDays < 0) {
      return { ok: false, error: 'elapsed mode: offsetDays (>=0) is required' };
    }
    if (typeof body.offsetMinutes !== 'number' || body.offsetMinutes < 0 || body.offsetMinutes >= 1440) {
      return { ok: false, error: 'elapsed mode: offsetMinutes (0..1439) is required' };
    }
    return { ok: true };
  }
  // absolute_time
  if (body.delayMinutes != null || body.offsetMinutes != null) {
    return { ok: false, error: 'absolute_time mode: only offsetDays + deliveryTime are allowed' };
  }
  if (typeof body.offsetDays !== 'number' || body.offsetDays < 0) {
    return { ok: false, error: 'absolute_time mode: offsetDays (>=0) is required' };
  }
  if (typeof body.deliveryTime !== 'string' || !HHMM_RE.test(body.deliveryTime)) {
    return { ok: false, error: 'absolute_time mode: deliveryTime must match HH:MM' };
  }
  return { ok: true };
}

/** Convert D1 snake_case FriendScenario row to shared camelCase shape */
function serializeFriendScenario(row: DbFriendScenario) {
  return {
    id: row.id,
    friendId: row.friend_id,
    scenarioId: row.scenario_id,
    currentStepOrder: row.current_step_order,
    status: row.status,
    startedAt: row.started_at,
    nextDeliveryAt: row.next_delivery_at,
    updatedAt: row.updated_at,
  };
}

/**
 * PATCH /api/scenarios/reorder — 並び順をまとめて書く。
 *
 * 経路が /api/scenarios/:id より前にあるのは、:id に "reorder" として
 * 食われないようにするため。
 */
scenarios.patch('/api/scenarios/reorder', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ ids?: unknown }>();
    if (!Array.isArray(body.ids) || body.ids.some((v) => typeof v !== 'string')) {
      return c.json({ success: false, error: 'ids must be an array of scenario ids' }, 400);
    }
    if (body.ids.length > 500) {
      return c.json({ success: false, error: 'too many ids' }, 400);
    }
    await reorderScenarios(c.env.DB, body.ids as string[]);
    return c.json({ success: true, data: { updated: body.ids.length } });
  } catch (err) {
    console.error('PATCH /api/scenarios/reorder error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/scenarios - list all
scenarios.get('/api/scenarios', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    let items: DbScenarioWithStepCount[];
    if (lineAccountId) {
      // NULL line_account_id = global scenario (webhook.ts:211 / liff.ts:878 fire it for every
      // account). Include both account-bound and global rows so the list mirrors the engine.
      const result = await c.env.DB
        .prepare(
          `SELECT s.*, COUNT(ss.id) as step_count
           FROM scenarios s
           LEFT JOIN scenario_steps ss ON s.id = ss.scenario_id
           WHERE s.line_account_id IS NULL OR s.line_account_id = ?
           GROUP BY s.id
           ORDER BY s.created_at DESC`,
        )
        .bind(lineAccountId)
        .all<DbScenarioWithStepCount>();
      items = result.results;
    } else {
      items = await getScenarios(c.env.DB);
    }

    /*
     * 購読中と読了済の人数。
     *
     * 設計の一覧はこの2つを列で出す。これまでは通数（ステップ数）しか
     * 返しておらず、「作ったが誰も通っていない」シナリオを見分けられなかった。
     *
     * シナリオごとに数えると件数ぶん往復するので、1回で全部数えて配る。
     */
    const counts = new Map<string, { active: number; completed: number }>();
    try {
      const rows = await c.env.DB
        .prepare(
          `SELECT scenario_id,
                  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
                  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count
             FROM friend_scenarios
            GROUP BY scenario_id`,
        )
        .all<{ scenario_id: string; active_count: number; completed_count: number }>();
      for (const r of rows.results) {
        counts.set(r.scenario_id, {
          active: Number(r.active_count ?? 0),
          completed: Number(r.completed_count ?? 0),
        });
      }
    } catch {
      // 数えられなくても一覧は出す。人数だけ 0 になる。
    }

    return c.json({
      success: true,
      data: items.map((row) => ({
        ...serializeScenario(row),
        stepCount: row.step_count,
        subscriberCount: counts.get(row.id)?.active ?? 0,
        completedCount: counts.get(row.id)?.completed ?? 0,
      })),
    });
  } catch (err) {
    console.error('GET /api/scenarios error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/scenarios/:id - get with steps
scenarios.get('/api/scenarios/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const scenario = await getScenarioById(c.env.DB, id);

    if (!scenario) {
      return c.json({ success: false, error: 'Scenario not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        ...serializeScenario(scenario),
        steps: scenario.steps.map(serializeStep),
      },
    });
  } catch (err) {
    console.error('GET /api/scenarios/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/scenarios - create
scenarios.post('/api/scenarios', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string | null;
      triggerType: ScenarioTriggerType;
      triggerTagId?: string | null;
      isActive?: boolean;
      lineAccountId?: string | null;
      deliveryMode?: string;
      allowConcurrent?: boolean;
    }>();

    if (!body.name || !body.triggerType) {
      return c.json({ success: false, error: 'name and triggerType are required' }, 400);
    }

    const deliveryMode = body.deliveryMode ?? 'relative';
    if (!VALID_DELIVERY_MODES.includes(deliveryMode as DeliveryMode)) {
      return c.json({ success: false, error: 'invalid deliveryMode' }, 400);
    }

    let scenario = await createScenario(c.env.DB, {
      name: body.name,
      description: body.description ?? null,
      triggerType: body.triggerType,
      triggerTagId: body.triggerTagId ?? null,
      deliveryMode: deliveryMode as DeliveryMode,
      // 省略時は「並行を許す」。ここを既定で塞ぐと、いま複数のシナリオに
      // 入っている人への配信が止まる。
      allowConcurrent: body.allowConcurrent !== false,
    });

    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE scenarios SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, scenario.id).run();
    }

    // createScenario() always sets is_active=1; override if the caller requested inactive
    if (body.isActive === false) {
      const updated = await updateScenario(c.env.DB, scenario.id, { is_active: 0 });
      if (updated) scenario = updated;
    }

    return c.json({ success: true, data: serializeScenario(scenario) }, 201);
  } catch (err) {
    console.error('POST /api/scenarios error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/scenarios/:id - update (accepts camelCase fields from clients)
scenarios.put('/api/scenarios/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      triggerType?: ScenarioTriggerType;
      triggerTagId?: string | null;
      isActive?: boolean;
      deliveryMode?: DeliveryMode;
      allowConcurrent?: boolean;
    }>();

    /*
     * 配信方式は「通がまだ1つも無いとき」だけ変えられる。
     *
     * 設計（配信方式の選択）は、シナリオを作ってから方式を選ぶ流れ。
     * 作った直後は通が0なので、ここを通る。
     *
     * 通があるときに変えると、通の予定（delay_minutes / offset_days /
     * delivery_time）が方式と食い違ったまま残る。どれを配信時刻と
     * みなすかが変わるので、黙って通すと配信の時刻がずれる。
     * 消してから変えてもらう。
     */
    if (body.deliveryMode !== undefined) {
      const row = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM scenario_steps WHERE scenario_id = ?`,
      )
        .bind(id)
        .first<{ n: number }>();
      if ((row?.n ?? 0) > 0) {
        return c.json(
          {
            success: false,
            error:
              '通がすでにあるため、配信方式を変えられません。通の予定の持ち方が方式ごとに違うためです。通を消してから変えてください。',
          },
          400,
        );
      }
    }

    const updated = await updateScenario(c.env.DB, id, {
      name: body.name,
      description: body.description,
      trigger_type: body.triggerType,
      trigger_tag_id: body.triggerTagId,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
      allow_concurrent:
        body.allowConcurrent !== undefined ? (body.allowConcurrent ? 1 : 0) : undefined,
      delivery_mode: body.deliveryMode,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Scenario not found' }, 404);
    }

    return c.json({ success: true, data: serializeScenario(updated) });
  } catch (err) {
    console.error('PUT /api/scenarios/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/scenarios/:id - delete
scenarios.delete('/api/scenarios/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    await deleteScenario(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/scenarios/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/scenarios/:id/steps - add step
scenarios.post('/api/scenarios/:id/steps', requireRole('owner', 'admin'), async (c) => {
  try {
    const scenarioId = c.req.param('id');
    const body = await c.req.json<{
      stepOrder: number;
      delayMinutes?: number;
      offsetDays?: number;
      offsetMinutes?: number;
      deliveryTime?: string;
      messageType: MessageType;
      messageContent: string;
      conditionType?: string | null;
      conditionValue?: string | null;
      nextStepOnFalse?: number | null;
      templateId?: string | null;
      onReachTagId?: string | null;
      afterSend?: 'continue' | 'pause';
    }>();

    if (body.stepOrder === undefined || !body.messageType || !body.messageContent) {
      return c.json(
        { success: false, error: 'stepOrder, messageType, and messageContent are required' },
        400,
      );
    }

    const scenarioRow = await c.env.DB
      .prepare(`SELECT delivery_mode FROM scenarios WHERE id = ?`)
      .bind(scenarioId)
      .first<{ delivery_mode: DeliveryMode }>();
    if (!scenarioRow) {
      return c.json({ success: false, error: 'Scenario not found' }, 404);
    }

    const v = validateStepSchedule(scenarioRow.delivery_mode, body);
    if (!v.ok) return c.json({ success: false, error: v.error }, 400);

    const cv = validateStepCondition(body.conditionType, body.conditionValue);
    if (!cv.ok) return c.json({ success: false, error: cv.error }, 400);

    // templateId / onReachTagId 参照整合性チェック
    if (body.templateId != null) {
      const tpl = await c.env.DB
        .prepare(`SELECT id FROM templates WHERE id = ?`)
        .bind(body.templateId)
        .first<{ id: string }>();
      if (!tpl) return c.json({ success: false, error: 'templateId not found' }, 400);
    }
    if (body.onReachTagId != null) {
      const tag = await c.env.DB
        .prepare(`SELECT id FROM tags WHERE id = ?`)
        .bind(body.onReachTagId)
        .first<{ id: string }>();
      if (!tag) return c.json({ success: false, error: 'onReachTagId not found' }, 400);
    }

    const step = await createScenarioStep(c.env.DB, {
      scenarioId,
      stepOrder: body.stepOrder,
      delayMinutes: body.delayMinutes ?? 0,
      messageType: body.messageType,
      messageContent: body.messageContent,
      conditionType: body.conditionType ?? null,
      conditionValue: body.conditionValue ?? null,
      nextStepOnFalse: body.nextStepOnFalse ?? null,
      offsetDays: body.offsetDays ?? null,
      offsetMinutes: body.offsetMinutes ?? null,
      deliveryTime: body.deliveryTime ?? null,
      templateId: body.templateId ?? null,
      onReachTagId: body.onReachTagId ?? null,
      // 知らない値は 'continue'。列の CHECK に引っかかって 500 になるより、
      // これまでの動き（次へ進む）に寄せる。
      afterSend: body.afterSend === 'pause' ? 'pause' : 'continue',
    });

    return c.json({ success: true, data: serializeStep(step) }, 201);
  } catch (err) {
    console.error('POST /api/scenarios/:id/steps error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/scenarios/:id/steps/:stepId - update step (accepts camelCase)
scenarios.put('/api/scenarios/:id/steps/:stepId', requireRole('owner', 'admin'), async (c) => {
  try {
    const scenarioId = c.req.param('id');
    const stepId = c.req.param('stepId');
    const body = await c.req.json<{
      stepOrder?: number;
      delayMinutes?: number;
      offsetDays?: number;
      offsetMinutes?: number;
      deliveryTime?: string;
      messageType?: MessageType;
      messageContent?: string;
      conditionType?: string | null;
      conditionValue?: string | null;
      nextStepOnFalse?: number | null;
      templateId?: string | null;
      onReachTagId?: string | null;
      afterSend?: 'continue' | 'pause';
    }>();

    // conditionType / conditionValue の partial-update 検証（OSS issue #120 回帰防止）。
    // どちらかが touched なときだけ走らせる。effective 値は、body に来た値を優先しつつ
    // 既存行で穴埋めして組み立て、validateStepCondition で pair を検証する。
    // これにより「type だけ flipping、value は既存」のような partial 更新を壊さずに、
    // 未知 type や JSON 異形を確実に弾ける。
    if (body.conditionType !== undefined || body.conditionValue !== undefined) {
      const existingCond = await c.env.DB
        .prepare(`SELECT condition_type, condition_value FROM scenario_steps WHERE id = ? AND scenario_id = ?`)
        .bind(stepId, scenarioId)
        .first<{ condition_type: string | null; condition_value: string | null }>();
      if (!existingCond) {
        return c.json({ success: false, error: 'Step not found' }, 404);
      }
      const effectiveType = body.conditionType !== undefined ? body.conditionType : existingCond.condition_type;
      const effectiveValue = body.conditionValue !== undefined ? body.conditionValue : existingCond.condition_value;
      const cv = validateStepCondition(effectiveType, effectiveValue);
      if (!cv.ok) return c.json({ success: false, error: cv.error }, 400);
    }

    // templateId / onReachTagId 参照整合性チェック (null は解除を意図、bypass)
    // templateId が指定された場合は内容も取得して snapshot 更新に使う。
    let templateSnapshot: { message_type: string; message_content: string } | null = null;
    if (body.templateId !== undefined && body.templateId !== null) {
      const tpl = await c.env.DB
        .prepare(`SELECT id, message_type, message_content FROM templates WHERE id = ?`)
        .bind(body.templateId)
        .first<{ id: string; message_type: string; message_content: string }>();
      if (!tpl) return c.json({ success: false, error: 'templateId not found' }, 400);
      templateSnapshot = { message_type: tpl.message_type, message_content: tpl.message_content };
    }
    if (body.onReachTagId !== undefined && body.onReachTagId !== null) {
      const tag = await c.env.DB
        .prepare(`SELECT id FROM tags WHERE id = ?`)
        .bind(body.onReachTagId)
        .first<{ id: string }>();
      if (!tag) return c.json({ success: false, error: 'onReachTagId not found' }, 400);
    }

    // スケジュールフィールドが1つでも指定されている場合は、既存値を DB から読んで
    // partial body と merge してから validateStepSchedule に渡す。
    // (1 フィールドだけ更新するケース、例: elapsed step の offsetMinutes だけ変更、
    //  absolute_time step の deliveryTime だけ変更 を許可するため)
    const scheduleTouched =
      body.delayMinutes != null ||
      body.offsetDays != null ||
      body.offsetMinutes != null ||
      body.deliveryTime != null;
    if (scheduleTouched) {
      const scenarioRow = await c.env.DB
        .prepare(`SELECT delivery_mode FROM scenarios WHERE id = ?`)
        .bind(scenarioId)
        .first<{ delivery_mode: DeliveryMode }>();
      if (!scenarioRow) {
        return c.json({ success: false, error: 'Scenario not found' }, 404);
      }
      const existingStep = await c.env.DB
        .prepare(
          `SELECT delay_minutes, offset_days, offset_minutes, delivery_time
           FROM scenario_steps WHERE id = ? AND scenario_id = ?`,
        )
        .bind(stepId, scenarioId)
        .first<{
          delay_minutes: number;
          offset_days: number | null;
          offset_minutes: number | null;
          delivery_time: string | null;
        }>();
      if (!existingStep) {
        return c.json({ success: false, error: 'Step not found' }, 404);
      }
      // mode mismatch (relative scenario に offsetDays を投げる等) は body の生値で検出する。
      // 一方、対応 mode のフィールドが片方だけ送られた場合 (例: absolute_time で deliveryTime のみ)
      // は既存値で穴埋めする。
      const scheduleForValidation: {
        delayMinutes?: number;
        offsetDays?: number;
        offsetMinutes?: number;
        deliveryTime?: string;
      } = {
        delayMinutes: body.delayMinutes,
        offsetDays: body.offsetDays,
        offsetMinutes: body.offsetMinutes,
        deliveryTime: body.deliveryTime,
      };
      if (scenarioRow.delivery_mode === 'relative') {
        if (scheduleForValidation.delayMinutes === undefined) {
          scheduleForValidation.delayMinutes = existingStep.delay_minutes;
        }
      } else if (scenarioRow.delivery_mode === 'elapsed') {
        if (scheduleForValidation.offsetDays === undefined && existingStep.offset_days != null) {
          scheduleForValidation.offsetDays = existingStep.offset_days;
        }
        if (scheduleForValidation.offsetMinutes === undefined && existingStep.offset_minutes != null) {
          scheduleForValidation.offsetMinutes = existingStep.offset_minutes;
        }
      } else {
        // absolute_time
        if (scheduleForValidation.offsetDays === undefined && existingStep.offset_days != null) {
          scheduleForValidation.offsetDays = existingStep.offset_days;
        }
        if (scheduleForValidation.deliveryTime === undefined && existingStep.delivery_time != null) {
          scheduleForValidation.deliveryTime = existingStep.delivery_time;
        }
      }
      const v = validateStepSchedule(scenarioRow.delivery_mode, scheduleForValidation);
      if (!v.ok) return c.json({ success: false, error: v.error }, 400);
    }

    // templateId が指定された場合は snapshot (message_type/message_content) も
    // 同時に更新する。templates テーブルから取った値を優先することで、stale な
    // body 内容 (UI の templates state が古い等) が保存されるのを防ぐ。
    // templateId が指定されていない場合は body の値をそのまま使う (直接入力モード)。
    const effectiveMessageType = templateSnapshot
      ? ((templateSnapshot.message_type === 'carousel' ? 'flex' : templateSnapshot.message_type) as MessageType)
      : body.messageType;
    const effectiveMessageContent = templateSnapshot
      ? templateSnapshot.message_content
      : body.messageContent;

    const updated = await updateScenarioStep(c.env.DB, stepId, {
      step_order: body.stepOrder,
      delay_minutes: body.delayMinutes,
      message_type: effectiveMessageType,
      message_content: effectiveMessageContent,
      condition_type: body.conditionType,
      condition_value: body.conditionValue,
      next_step_on_false: body.nextStepOnFalse,
      offset_days: body.offsetDays,
      offset_minutes: body.offsetMinutes,
      delivery_time: body.deliveryTime,
      template_id: body.templateId,
      on_reach_tag_id: body.onReachTagId,
      after_send:
        body.afterSend === undefined ? undefined : body.afterSend === 'pause' ? 'pause' : 'continue',
    });

    if (!updated) {
      return c.json({ success: false, error: 'Step not found' }, 404);
    }

    return c.json({ success: true, data: serializeStep(updated) });
  } catch (err) {
    console.error('PUT /api/scenarios/:id/steps/:stepId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/scenarios/:id/steps/:stepId - delete step
scenarios.delete('/api/scenarios/:id/steps/:stepId', requireRole('owner', 'admin'), async (c) => {
  try {
    const stepId = c.req.param('stepId');
    await deleteScenarioStep(c.env.DB, stepId);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/scenarios/:id/steps/:stepId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/scenarios/:id/steps/reorder - bulk update step_order
scenarios.post('/api/scenarios/:id/steps/reorder', requireRole('owner', 'admin'), async (c) => {
  try {
    const scenarioId = c.req.param('id');
    const body = await c.req.json<{ orders: { stepId: string; stepOrder: number }[] }>();

    if (!Array.isArray(body.orders) || body.orders.length === 0) {
      return c.json({ success: false, error: 'orders must be a non-empty array' }, 400);
    }
    for (const o of body.orders) {
      if (typeof o.stepId !== 'string' || typeof o.stepOrder !== 'number' || o.stepOrder < 1) {
        return c.json({ success: false, error: 'invalid orders entry' }, 400);
      }
    }

    // 既存ステップの step_order と next_step_on_false を取得して、
    // 旧 step_order → 新 step_order のマップを構築する。
    // 既存の branching (next_step_on_false) を保つには、移動する step の旧→新 step_order マップで
    // 各 step の next_step_on_false 値を書き換える必要がある。
    const existing = await c.env.DB
      .prepare(`SELECT id, step_order FROM scenario_steps WHERE scenario_id = ?`)
      .bind(scenarioId)
      .all<{ id: string; step_order: number }>();
    const oldOrderById = new Map(existing.results.map((r) => [r.id, r.step_order]));
    // moved set: stepId → newOrder
    const newOrderById = new Map(body.orders.map((o) => [o.stepId, o.stepOrder]));
    // old → new step_order map (only for moved steps)
    const oldToNew = new Map<number, number>();
    for (const [stepId, newOrder] of newOrderById) {
      const oldOrder = oldOrderById.get(stepId);
      if (oldOrder !== undefined && oldOrder !== newOrder) {
        oldToNew.set(oldOrder, newOrder);
      }
    }

    // UNIQUE(scenario_id, step_order) 衝突回避: 一旦負数空間に逃がしてから最終値に再代入する2フェーズ。
    const phase1 = body.orders.map((o, i) =>
      c.env.DB
        .prepare(`UPDATE scenario_steps SET step_order = ? WHERE id = ? AND scenario_id = ?`)
        .bind(-1 - i, o.stepId, scenarioId),
    );
    const phase2 = body.orders.map((o) =>
      c.env.DB
        .prepare(`UPDATE scenario_steps SET step_order = ? WHERE id = ? AND scenario_id = ?`)
        .bind(o.stepOrder, o.stepId, scenarioId),
    );
    // phase3: branching ターゲット (next_step_on_false) も同様に2フェーズで書き換える。
    // 入れ替え (A 旧2→新4, B 旧4→新2) のケースで一発 UPDATE すると後続が前の結果を上書きするため、
    // 一旦負数 sentinel に逃がしてから新値に書く。
    const oldToNewArr = Array.from(oldToNew.entries());
    const phase3a = oldToNewArr.map(([oldOrder], i) =>
      c.env.DB
        .prepare(
          `UPDATE scenario_steps SET next_step_on_false = ?
           WHERE scenario_id = ? AND next_step_on_false = ?`,
        )
        .bind(-1000 - i, scenarioId, oldOrder),
    );
    const phase3b = oldToNewArr.map(([, newOrder], i) =>
      c.env.DB
        .prepare(
          `UPDATE scenario_steps SET next_step_on_false = ?
           WHERE scenario_id = ? AND next_step_on_false = ?`,
        )
        .bind(newOrder, scenarioId, -1000 - i),
    );
    await c.env.DB.batch([...phase1, ...phase2, ...phase3a, ...phase3b]);

    return c.json({ success: true });
  } catch (err) {
    console.error('POST /api/scenarios/:id/steps/reorder error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/scenarios/:id/preview - timeline preview (deterministic, no jitter)
const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

scenarios.get('/api/scenarios/:id/preview', async (c) => {
  try {
    const scenarioId = c.req.param('id');
    const scenarioRow = await c.env.DB
      .prepare(`SELECT delivery_mode FROM scenarios WHERE id = ?`)
      .bind(scenarioId)
      .first<{ delivery_mode: DeliveryMode }>();
    if (!scenarioRow) return c.json({ success: false, error: 'Scenario not found' }, 404);

    const stepsResult = await c.env.DB
      .prepare(
        `SELECT id, step_order, delay_minutes, offset_days, offset_minutes, delivery_time,
                template_id, message_type, message_content
         FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC`,
      )
      .bind(scenarioId)
      .all<{
        id: string;
        step_order: number;
        delay_minutes: number;
        offset_days: number | null;
        offset_minutes: number | null;
        delivery_time: string | null;
        template_id: string | null;
        message_type: string;
        message_content: string;
      }>();
    const steps = stepsResult.results;

    // 配信時と同じ resolveStepContent を呼んで、template_id があれば templates から
    // 最新内容を取って preview に返す。これで配信と preview の表示が一致する。
    const resolvedSteps = await Promise.all(
      steps.map(async (step) => {
        const resolved = await resolveStepContent(c.env.DB, step);
        return { step, resolved };
      }),
    );

    // computeNextDeliveryAt は「JST clock-time を UTC として表現する Date」前提。
    // クエリの startParam は "+09:00" 付き ISO で本物の UTC instant として parse されるため、
    // +9h ずらして JST clock-time 表現に揃える。default の now も同様にずらして表現する。
    const startParam = c.req.query('startAt');
    const startAt = startParam
      ? new Date(new Date(startParam).getTime() + 9 * 60 * 60_000)
      : new Date(Date.now() + 9 * 60 * 60_000);

    // Day N はカレンダー日数差で算出。経過 24h 単位だと、enrolledAt 14:32 →
    // 翌日 09:00 (18.5h 後) が Day 0 と表示されてしまう (本来 Day 1)。
    // startAt と at は両方 JST clock-time として表現された Date なので、
    // 日付部分の差を計算すれば正しい Day N が出る。
    const startEpochDay = Math.floor(
      Date.UTC(startAt.getUTCFullYear(), startAt.getUTCMonth(), startAt.getUTCDate()) / 86_400_000,
    );
    let prev = startAt;
    const timeline = resolvedSteps.map(({ step, resolved }) => {
      const at = computeNextDeliveryAt(
        { delivery_mode: scenarioRow.delivery_mode },
        step,
        { enrolledAt: startAt, previousDeliveredAt: prev, now: startAt },
      );
      prev = at;
      const atEpochDay = Math.floor(
        Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) / 86_400_000,
      );
      const day = atEpochDay - startEpochDay;
      const hh = String(at.getHours()).padStart(2, '0');
      const mm = String(at.getMinutes()).padStart(2, '0');
      const wd = WEEKDAY_JA[at.getDay()];
      return {
        stepOrder: step.step_order,
        deliveryAt: at.toISOString().slice(0, -1) + '+09:00',
        deliveryAtLabel: `Day ${day} ${hh}:${mm} (${wd})`,
        messageType: resolved.messageType,
        messageContent: resolved.messageContent,
      };
    });

    return c.json({
      success: true,
      data: {
        startAt: startAt.toISOString().slice(0, -1) + '+09:00',
        steps: timeline,
      },
    });
  } catch (err) {
    console.error('GET /api/scenarios/:id/preview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/scenarios/:id/stats - reach rate dashboard
scenarios.get('/api/scenarios/:id/stats', async (c) => {
  try {
    const scenarioId = c.req.param('id');
    const scenario = await c.env.DB
      .prepare(`SELECT id FROM scenarios WHERE id = ?`)
      .bind(scenarioId)
      .first<{ id: string }>();
    if (!scenario) {
      return c.json({ success: false, error: 'Scenario not found' }, 404);
    }
    const stats = await computeScenarioStats(c.env.DB, scenarioId);
    return c.json({ success: true, data: stats });
  } catch (err) {
    console.error('GET /api/scenarios/:id/stats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/scenarios/:id/enroll/:friendId - manually enroll friend
scenarios.post('/api/scenarios/:id/enroll/:friendId', requireRole('owner', 'admin'), async (c) => {
  try {
    const scenarioId = c.req.param('id');
    const friendId = c.req.param('friendId');
    const db = c.env.DB;

    // Verify both exist
    const [scenario, friend] = await Promise.all([
      getScenarioById(db, scenarioId),
      getFriendById(db, friendId),
    ]);

    if (!scenario) {
      return c.json({ success: false, error: 'Scenario not found' }, 404);
    }
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const enrollment = await enrollFriendInScenario(db, friendId, scenarioId);
    if (!enrollment) {
      return c.json({ success: false, error: 'Already enrolled in this scenario' }, 409);
    }
    return c.json({ success: true, data: serializeFriendScenario(enrollment) }, 201);
  } catch (err) {
    console.error('POST /api/scenarios/:id/enroll/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { scenarios };
