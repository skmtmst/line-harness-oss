import { Hono } from 'hono';
import {
  getTemplatesWithUsageCount,
  getTemplateById,
  getTemplateUsage,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getCarouselTapTotals,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { validateCarousel } from '../services/carousel-validation.js';

const templates = new Hono<Env>();

/**
 * カルーセルなら中身を確かめる。
 *
 * 送ってから「400 が返りました」では、どのパネルが悪いのか分からない。
 * 保存の時点で、何枚目の何が問題かを返す。
 */
function checkCarousel(
  messageType: string | undefined,
  messageContent: string | undefined,
): { ok: true } | { ok: false; error: string } {
  if (messageType !== 'carousel') return { ok: true };
  if (!messageContent) return { ok: false, error: 'カルーセルの中身がありません' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(messageContent);
  } catch {
    return { ok: false, error: 'カルーセルの中身が読み取れません' };
  }
  // { columns: [...] } でも [...] でも受ける。書き方の違いで弾かない。
  const columns =
    Array.isArray(parsed)
      ? parsed
      : (parsed as { columns?: unknown })?.columns;
  const errors = validateCarousel(columns);
  if (errors.length === 0) return { ok: true };
  return { ok: false, error: errors.map((e) => e.message).join(' / ') };
}


templates.get('/api/templates', async (c) => {
  try {
    const category = c.req.query('category') ?? undefined;
    const items = await getTemplatesWithUsageCount(c.env.DB, category);
    // 押された回数は1回のクエリでまとめて取る。1件ずつ引くと、
    // 20件並べば20回叩くことになる。
    let taps = new Map<string, number>();
    try {
      taps = await getCarouselTapTotals(c.env.DB);
    } catch (err) {
      // 数が出ないだけ。一覧そのものは出す。
      console.error('GET /api/templates — failed to count carousel taps', err);
    }
    return c.json({
      success: true,
      data: items.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        messageType: t.message_type,
        messageContent: t.message_content,
        folderId: t.folder_id ?? null,
        usageCount: t.usage_count,
        /** 162: 選択肢が押された回数の合計。押される仕掛けが無いものは 0。 */
        tapCount: taps.get(t.id) ?? 0,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/templates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templates.get('/api/templates/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const item = await getTemplateById(c.env.DB, id);
    if (!item) return c.json({ success: false, error: 'Template not found' }, 404);
    const usedBy = await getTemplateUsage(c.env.DB, id);
    return c.json({
      success: true,
      data: {
        id: item.id,
        name: item.name,
        category: item.category,
        messageType: item.message_type,
        messageContent: item.message_content,
        carouselActions: item.carousel_actions_json
          ? JSON.parse(item.carousel_actions_json)
          : null,
        carouselTapLimitMode: item.carousel_tap_limit_mode ?? 'none',
        carouselTapLimitText: item.carousel_tap_limit_text,
        usedBy,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      },
    });
  } catch (err) {
    console.error('GET /api/templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/templates/:id/usages — auto_replies + scenario_steps での使用箇所
templates.get('/api/templates/:id/usages', async (c) => {
  try {
    const templateId = c.req.param('id');

    const tpl = await c.env.DB
      .prepare(`SELECT id FROM templates WHERE id = ?`)
      .bind(templateId)
      .first<{ id: string }>();
    if (!tpl) {
      return c.json({ success: false, error: 'Template not found' }, 404);
    }

    const autoRepliesResult = await c.env.DB
      .prepare(
        `SELECT id, keyword, line_account_id FROM auto_replies WHERE template_id = ?`,
      )
      .bind(templateId)
      .all<{ id: string; keyword: string; line_account_id: string | null }>();

    const scenarioStepsResult = await c.env.DB
      .prepare(
        `SELECT ss.id AS step_id, ss.step_order, ss.scenario_id,
                s.name AS scenario_name
         FROM scenario_steps ss
         JOIN scenarios s ON ss.scenario_id = s.id
         WHERE ss.template_id = ?
         ORDER BY s.name, ss.step_order`,
      )
      .bind(templateId)
      .all<{
        step_id: string;
        step_order: number;
        scenario_id: string;
        scenario_name: string;
      }>();

    return c.json({
      success: true,
      data: {
        autoReplies: autoRepliesResult.results.map((r) => ({
          id: r.id,
          keyword: r.keyword,
          lineAccountId: r.line_account_id ?? null,
        })),
        scenarioSteps: scenarioStepsResult.results.map((r) => ({
          scenarioId: r.scenario_id,
          scenarioName: r.scenario_name,
          stepId: r.step_id,
          stepOrder: r.step_order,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/templates/:id/usages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 162: カルーセルの選択肢まわりの設定を読む。 */
function readCarouselOptions(body: Record<string, unknown>):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } {
  const value: Record<string, unknown> = {};
  if ('carouselActions' in body) {
    const raw = body.carouselActions;
    if (raw === null) {
      value.carouselActions = null;
    } else if (typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'carouselActions must be an object keyed by column index' };
    } else {
      value.carouselActions = raw;
    }
  }
  if ('carouselTapLimitMode' in body) {
    if (body.carouselTapLimitMode !== 'none' && body.carouselTapLimitMode !== 'once') {
      return { ok: false, error: "carouselTapLimitMode must be 'none' or 'once'" };
    }
    value.carouselTapLimitMode = body.carouselTapLimitMode;
  }
  if ('carouselTapLimitText' in body) {
    const raw = body.carouselTapLimitText;
    if (raw === null || raw === '') {
      value.carouselTapLimitText = null;
    } else if (typeof raw !== 'string') {
      return { ok: false, error: 'carouselTapLimitText must be a string' };
    } else if ([...raw].length > 300) {
      return { ok: false, error: 'carouselTapLimitText must be 300 characters or fewer' };
    } else {
      value.carouselTapLimitText = raw;
    }
  }
  return { ok: true, value };
}

templates.post('/api/templates', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name: string; category?: string; messageType: string; messageContent: string }>();
    if (!body.name || !body.messageType || !body.messageContent) {
      return c.json({ success: false, error: 'name, messageType, messageContent are required' }, 400);
    }
    const carousel = checkCarousel(body.messageType, body.messageContent);
    if (!carousel.ok) return c.json({ success: false, error: carousel.error }, 422);
    const options = readCarouselOptions(body as unknown as Record<string, unknown>);
    if (!options.ok) return c.json({ success: false, error: options.error }, 400);
    const item = await createTemplate(c.env.DB, { ...body, ...options.value });
    return c.json({ success: true, data: { id: item.id, name: item.name, category: item.category, messageType: item.message_type, createdAt: item.created_at } }, 201);
  } catch (err) {
    console.error('POST /api/templates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templates.put('/api/templates/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ messageType?: string; messageContent?: string }>();
    // 種別が送られていなければ、いまの種別で見る。本文だけ直す場合がある。
    const existing = await getTemplateById(c.env.DB, id);
    const carousel = checkCarousel(
      body.messageType ?? existing?.message_type,
      body.messageContent ?? existing?.message_content,
    );
    if (!carousel.ok) return c.json({ success: false, error: carousel.error }, 422);
    const options = readCarouselOptions(body as unknown as Record<string, unknown>);
    if (!options.ok) return c.json({ success: false, error: options.error }, 400);
    await updateTemplate(c.env.DB, id, { ...body, ...options.value });
    const updated = await getTemplateById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        category: updated.category,
        messageType: updated.message_type,
        messageContent: updated.message_content,
        carouselActions: updated.carousel_actions_json
          ? JSON.parse(updated.carousel_actions_json)
          : null,
        carouselTapLimitMode: updated.carousel_tap_limit_mode ?? 'none',
        carouselTapLimitText: updated.carousel_tap_limit_text,
      },
    });
  } catch (err) {
    console.error('PUT /api/templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templates.delete('/api/templates/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    // automations.actions JSON には FK が無いので、削除すると orphan な template_id が
    // 残って実行時に空メッセージ送信→partial fail を引き起こす。auto_replies は
    // ON DELETE SET NULL + inline fallback (responseContent snapshot) で大丈夫だが、
    // automations は安全な fallback パスがないので、参照があれば削除を拒否する。
    const usage = await getTemplateUsage(c.env.DB, id);
    if (usage.automations.length > 0) {
      return c.json({
        success: false,
        error: `automation rule (${usage.automations.length} 件) でこのテンプレートを参照しています。先にそちらの参照を解除してください。`,
        usedBy: usage,
      }, 409);
    }
    await deleteTemplate(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { templates };
