import { Hono } from 'hono';
import {
  getTemplatesWithUsageCount,
  getTemplateById,
  getTemplateUsage,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getCarouselTapTotals,
  getFolderById,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { validateCarousel } from '../services/carousel-validation.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { parseQuestion, type ScenarioQuestion } from '../services/scenario-question.js';
import { validateTemplateMessage } from '../services/template-message-validation.js';

const templates = new Hono<Env>();

/**
 * 置き場の指定を読む。
 *
 * **3つを分けて扱う。**
 *   来ない（`undefined`）…… いまの置き場のまま
 *   `null` / 空文字      …… 未分類へ戻す
 *   ID                   …… そのフォルダへ入れる
 *
 * 消えたフォルダや、別の用途のフォルダ（タグの分類など）を指されたら断る。
 * **黙って未分類にしない。** 移したつもりが未分類になっていると、
 * 画面では「移せた」ように見えて、次に開くと消えている。
 */
async function readFolderId(
  db: D1Database,
  body: Record<string, unknown>,
): Promise<{ ok: true; folderId?: string | null } | { ok: false; error: string }> {
  if (!('folderId' in body)) return { ok: true };
  const raw = body.folderId;
  if (raw === null || raw === '') return { ok: true, folderId: null };
  const id = String(raw);
  const folder = await getFolderById(db, id);
  if (!folder) return { ok: false, error: 'そのフォルダはありません' };
  if (folder.kind !== 'template') {
    return { ok: false, error: 'テンプレートのフォルダではありません' };
  }
  return { ok: true, folderId: id };
}


const QUESTION_BEHAVIORS = new Set([
  'none',
  'url',
  'tel',
  'add_friend',
  'mail',
  'form',
  'scenario',
]);

function readQuestionPayload(body: Record<string, unknown>):
  | { ok: true; question: ScenarioQuestion | null; questionJson?: string | null }
  | { ok: false; error: string } {
  if (!('question' in body)) return { ok: true, question: null };
  if (body.question === null) return { ok: true, question: null, questionJson: null };
  if (!body.question || typeof body.question !== 'object' || Array.isArray(body.question)) {
    return { ok: false, error: '質問の内容を読み取れません' };
  }
  const raw = JSON.stringify(body.question);
  const question = parseQuestion(raw);
  if (!question) return { ok: false, error: '質問文と選択肢を入力してください' };
  if (question.text.length > 160) return { ok: false, error: '質問文は160文字以内で入力してください' };
  if (question.choices.length > 13) return { ok: false, error: '選択肢は13件以内で入力してください' };
  if (question.choices.some((choice) => !choice || typeof choice !== 'object' || typeof choice.label !== 'string')) {
    return { ok: false, error: 'すべての選択肢に文字を入力してください' };
  }
  if (question.choices.some((choice) => !choice.label.trim())) {
    return { ok: false, error: 'すべての選択肢に文字を入力してください' };
  }
  if (question.choices.some((choice) => choice.label.length > 20)) {
    return { ok: false, error: '選択肢の文字は20文字以内で入力してください' };
  }
  if (question.choices.some((choice) => typeof choice.behavior !== 'string' || !QUESTION_BEHAVIORS.has(choice.behavior))) {
    return { ok: false, error: '選択後の動きを確認してください' };
  }
  return { ok: true, question, questionJson: raw };
}

function questionValue(raw: string | null): ScenarioQuestion | null {
  return parseQuestion(raw);
}

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
    const requestedAccountId = c.req.query('account_id');
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (requestedAccountId && !scope.allowedAccountIds.includes(requestedAccountId)) {
      return c.json({ success: false, error: 'Template not found' }, 404);
    }
    const items = await getTemplatesWithUsageCount(c.env.DB, category, {
      accountIds: requestedAccountId ? [requestedAccountId] : scope.allowedAccountIds,
      includeUnassigned: requestedAccountId ? false : scope.canSeeUnassigned,
    });
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
        accountId: t.line_account_id,
        name: t.name,
        category: t.category,
        messageType: t.message_type,
        messageContent: t.message_content,
        question: questionValue(t.question_json),
        questionStatus: t.question_status,
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
    if (!item || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [item.line_account_id])) {
      return c.json({ success: false, error: 'Template not found' }, 404);
    }
    const usedBy = await getTemplateUsage(c.env.DB, id);
    return c.json({
      success: true,
      data: {
        id: item.id,
        accountId: item.line_account_id,
        name: item.name,
        category: item.category,
        messageType: item.message_type,
        messageContent: item.message_content,
        question: questionValue(item.question_json),
        questionStatus: item.question_status,
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

function templateUsageCount(usage: Awaited<ReturnType<typeof getTemplateUsage>>): number {
  return Object.values(usage).reduce((total, items) => total + items.length, 0);
}

// GET /api/templates/:id/usages — 現行 templates.id を参照する設定をまとめて返す
templates.get('/api/templates/:id/usages', async (c) => {
  try {
    const templateId = c.req.param('id');

    const tpl = await getTemplateById(c.env.DB, templateId);
    if (!tpl || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [tpl.line_account_id])) {
      return c.json({ success: false, error: 'Template not found' }, 404);
    }

    return c.json({ success: true, data: await getTemplateUsage(c.env.DB, templateId) });
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
    const body = await c.req.json<{
      accountId?: string;
      name: string;
      category?: string;
      messageType: string;
      messageContent: string;
      question?: unknown;
      questionStatus?: 'draft' | 'published';
      folderId?: string | null;
    }>();
    if (!body.accountId) {
      return c.json({ success: false, error: 'account_id_required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
      return c.json({ success: false, error: 'Template not found' }, 404);
    }
    if (!body.name || !body.messageType || !body.messageContent) {
      return c.json({ success: false, error: 'name, messageType, messageContent are required' }, 400);
    }
    const message = validateTemplateMessage(body.messageType, body.messageContent);
    if (!message.ok) {
      const { ok: _ok, ...failure } = message;
      return c.json({ success: false, ...failure }, 422);
    }
    const carousel = checkCarousel(body.messageType, body.messageContent);
    if (!carousel.ok) return c.json({ success: false, error: carousel.error }, 422);
    const options = readCarouselOptions(body as unknown as Record<string, unknown>);
    if (!options.ok) return c.json({ success: false, error: options.error }, 400);
    const question = readQuestionPayload(body as unknown as Record<string, unknown>);
    if (!question.ok) return c.json({ success: false, error: question.error }, 422);
    if (body.questionStatus && body.questionStatus !== 'draft' && body.questionStatus !== 'published') {
      return c.json({ success: false, error: '質問の保存状態を確認してください' }, 400);
    }
    const folder = await readFolderId(c.env.DB, body as unknown as Record<string, unknown>);
    if (!folder.ok) return c.json({ success: false, error: folder.error }, 422);
    const item = await createTemplate(c.env.DB, {
      ...body,
      folderId: folder.folderId ?? null,
      lineAccountId: body.accountId,
      ...options.value,
      questionJson: question.questionJson,
      questionStatus: body.questionStatus,
      // 質問を扱わない利用先で選ばれても、壊れたFlexを送らず質問文を送る。
      ...(question.question
        ? { messageType: 'text', messageContent: question.question.intro?.trim() || question.question.text }
        : {}),
    });
    return c.json({ success: true, data: { id: item.id, name: item.name, category: item.category, messageType: item.message_type, question: questionValue(item.question_json), questionStatus: item.question_status, folderId: item.folder_id ?? null, createdAt: item.created_at } }, 201);
  } catch (err) {
    console.error('POST /api/templates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templates.put('/api/templates/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ messageType?: string; messageContent?: string; question?: unknown; questionStatus?: 'draft' | 'published'; folderId?: string | null }>();
    // 種別が送られていなければ、いまの種別で見る。本文だけ直す場合がある。
    const existing = await getTemplateById(c.env.DB, id);
    if (!existing || !await canAccessAllLineAccounts(
      c.env.DB, c.get('staff'), [existing.line_account_id],
    )) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const changesMessage = body.messageType !== undefined || body.messageContent !== undefined;
    const message = changesMessage
      ? validateTemplateMessage(
          body.messageType ?? existing.message_type,
          body.messageContent ?? existing.message_content,
        )
      : { ok: true as const };
    if (!message.ok) {
      const { ok: _ok, ...failure } = message;
      return c.json({ success: false, ...failure }, 422);
    }
    const carousel = checkCarousel(
      body.messageType ?? existing?.message_type,
      body.messageContent ?? existing?.message_content,
    );
    if (!carousel.ok) return c.json({ success: false, error: carousel.error }, 422);
    const options = readCarouselOptions(body as unknown as Record<string, unknown>);
    if (!options.ok) return c.json({ success: false, error: options.error }, 400);
    const question = readQuestionPayload(body as unknown as Record<string, unknown>);
    if (!question.ok) return c.json({ success: false, error: question.error }, 422);
    if (body.questionStatus && body.questionStatus !== 'draft' && body.questionStatus !== 'published') {
      return c.json({ success: false, error: '質問の保存状態を確認してください' }, 400);
    }
    const folder = await readFolderId(c.env.DB, body as unknown as Record<string, unknown>);
    if (!folder.ok) return c.json({ success: false, error: folder.error }, 422);
    await updateTemplate(c.env.DB, id, {
      ...body,
      ...(folder.folderId !== undefined ? { folderId: folder.folderId } : {}),
      ...options.value,
      questionJson: question.questionJson,
      questionStatus: body.questionStatus,
      ...(question.question
        ? { messageType: 'text', messageContent: question.question.intro?.trim() || question.question.text }
        : {}),
    });
    const updated = await getTemplateById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: updated.id,
        accountId: updated.line_account_id,
        name: updated.name,
        category: updated.category,
        messageType: updated.message_type,
        messageContent: updated.message_content,
        question: questionValue(updated.question_json),
        questionStatus: updated.question_status,
        folderId: updated.folder_id ?? null,
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
    const existing = await getTemplateById(c.env.DB, id);
    if (!existing || !await canAccessAllLineAccounts(
      c.env.DB, c.get('staff'), [existing.line_account_id],
    )) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    // ON DELETE SET NULL や本文の控えがあっても、参照中の設定を運用者に知らせず
    // 切ることはしない。すべての利用先を先に差し替えてもらう。
    const usage = await getTemplateUsage(c.env.DB, id);
    const usageCount = templateUsageCount(usage);
    if (usageCount > 0) {
      return c.json({
        success: false,
        code: 'IN_USE',
        usageCount,
        error: `${usageCount}件の設定で使用中です。先に使用先を差し替えてください。`,
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
