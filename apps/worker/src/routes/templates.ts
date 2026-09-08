import { Hono } from 'hono';
import {
  getTemplatesWithUsageCount,
  getTemplateSendCounts,
  getTemplateById,
  getTemplateUsage,
  createTemplate,
  updateTemplate,
  saveTemplateDraft,
  publishTemplate,
  hasTemplateDraft,
  deleteTemplate,
  getCarouselTapTotals,
  getFolderById,
} from '@line-crm/db';
import type { TemplateRow } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { buildOffsetListResponse, parseOffsetPaging } from '../lib/list-paging.js';
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
 * 347: 画面に見せる「編集中の内容」。下書きがあれば下書き、なければ公開版。
 * 送信側はこの口を通らず live 列を直接読むので、ここが下書きを返しても
 * 実送信文は公開版のまま。
 *
 * 差し戻し対応(要件2): 消せる項目(質問・カルーセル・制限超過文)は行単位で見る。
 * 下書きがある行の draft 列 NULL は「削除した」であり、公開版へ落とさない。
 */
function draftMessageTypeOf(t: TemplateRow): string {
  return t.draft_message_type ?? t.message_type;
}

function draftMessageContentOf(t: TemplateRow): string {
  return t.draft_message_content ?? t.message_content;
}

function draftQuestionJsonOf(t: TemplateRow): string | null {
  return hasTemplateDraft(t) ? t.draft_question_json : t.question_json;
}

function draftQuestionStatusOf(t: TemplateRow): 'draft' | 'published' {
  return (hasTemplateDraft(t) ? t.draft_question_status ?? t.question_status : t.question_status);
}

function draftCarouselActionsOf(t: TemplateRow): unknown {
  const raw = hasTemplateDraft(t) ? t.draft_carousel_actions_json : t.carousel_actions_json;
  return raw ? JSON.parse(raw) : null;
}

function draftCarouselTapLimitModeOf(t: TemplateRow): string {
  return (hasTemplateDraft(t) ? t.draft_carousel_tap_limit_mode ?? t.carousel_tap_limit_mode : t.carousel_tap_limit_mode)
    ?? 'none';
}

function draftCarouselTapLimitTextOf(t: TemplateRow): string | null {
  return hasTemplateDraft(t) ? t.draft_carousel_tap_limit_text : t.carousel_tap_limit_text;
}

/** 347: 公開版の固定情報。編集・保存では変わらない。 */
function publishedInfoOf(t: TemplateRow) {
  return {
    messageType: t.message_type,
    messageContent: t.message_content,
    question: questionValue(t.question_json),
    questionStatus: t.question_status,
  };
}

function versionInfoOf(t: TemplateRow) {
  return {
    hasDraft: hasTemplateDraft(t),
    publishedVersion: Number(t.published_version ?? 0),
    publishedAt: t.published_at ?? null,
    draftRevision: Number(t.draft_revision ?? 0),
    published: publishedInfoOf(t),
  };
}

/**
 * カルーセルなら中身を確かめる。
 *
 * 送ってから「400 が返りました」では、どのパネルが悪いのか分からない。
 * 保存の時点で、何枚目の何が問題かを返す。
 */
/**
 * JSONで持つ本文（カード型・カルーセル）の大きさ上限。タグ込みの文字数で見る。
 * テキスト上限5000字の10倍。LINEの上限ではなく、巨大JSONの保存・描画・送信を
 * 防ぐ運用上限。
 */
export const TEMPLATE_STRUCTURED_MAX_CHARACTERS = 50000;

function checkStructuredSize(
  messageType: string | undefined,
  messageContent: string | undefined,
): { ok: true } | { ok: false; error: string } {
  if ((messageType !== 'carousel' && messageType !== 'flex') || !messageContent) return { ok: true };
  if ([...messageContent].length > TEMPLATE_STRUCTURED_MAX_CHARACTERS) {
    return {
      ok: false,
      error: `本文が大きすぎます。${TEMPLATE_STRUCTURED_MAX_CHARACTERS.toLocaleString('ja-JP')}文字までにしてください`,
    };
  }
  return { ok: true };
}

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
    // 共通一覧契約。page/limit を付けたときだけ DB 側で切り出して新形で返す。
    const wantsPaging = c.req.query('page') !== undefined || c.req.query('limit') !== undefined;
    const paging = wantsPaging
      ? parseOffsetPaging({ page: c.req.query('page'), limit: c.req.query('limit') })
      : undefined;
    const { items, total } = await getTemplatesWithUsageCount(c.env.DB, category, {
      accountIds: requestedAccountId ? [requestedAccountId] : scope.allowedAccountIds,
      includeUnassigned: requestedAccountId ? false : scope.canSeeUnassigned,
    }, paging ? { limit: paging.limit, offset: paging.offset } : undefined);
    // 押された回数は1回のクエリでまとめて取る。1件ずつ引くと、
    // 20件並べば20回叩くことになる。
    let taps = new Map<string, number>();
    try {
      taps = await getCarouselTapTotals(c.env.DB);
    } catch (err) {
      // 数が出ないだけ。一覧そのものは出す。
      console.error('GET /api/templates — failed to count carousel taps', err);
    }
    let sends = new Map<string, { thisMonth: number; total: number }>();
    try {
      sends = await getTemplateSendCounts(c.env.DB, items.map((item) => item.id));
    } catch (err) {
      // 集計だけ取れないときも、テンプレートそのものは操作できるようにする。
      console.error('GET /api/templates — failed to count template sends', err);
    }
    /*
     * 差し戻し対応(要件1): 一覧の主 messageType/messageContent は公開版だけを返す。
     * 編集中の下書きがあってもここには出さず、実送信の候補選びが
     * 未公開の下書きを掴まないようにする。編集中の内容は編集画面が
     * 詳細口で読む。未公開(版0・公開日時なし)は候補から外す目印付きで返す。
     */
    const serialized = items.map((t) => ({
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
      monthlySendCount: sends.get(t.id)?.thisMonth ?? null,
      totalSendCount: sends.get(t.id)?.total ?? null,
      ...versionInfoOf(t),
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    }));
    if (wantsPaging && paging) {
      return c.json({
        success: true,
        data: buildOffsetListResponse({
          items: serialized,
          total,
          paging,
          sort: [
            { field: 'created_at', direction: 'desc' },
            { field: 'id', direction: 'asc' },
          ],
        }),
      });
    }
    return c.json({ success: true, data: serialized });
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
        messageType: draftMessageTypeOf(item),
        messageContent: draftMessageContentOf(item),
        question: questionValue(draftQuestionJsonOf(item)),
        questionStatus: draftQuestionStatusOf(item),
        folderId: item.folder_id ?? null,
        carouselActions: draftCarouselActionsOf(item),
        carouselTapLimitMode: draftCarouselTapLimitModeOf(item),
        carouselTapLimitText: draftCarouselTapLimitTextOf(item),
        ...versionInfoOf(item),
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
    const structured = checkStructuredSize(body.messageType, body.messageContent);
    if (!structured.ok) return c.json({ success: false, error: structured.error }, 422);
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
    // 作成の返しも更新と同じ形にする。将来使うときにハマらないため（#497 軽11）。
    // 差し戻し対応(要件4): 作った直後は未公開(版0・公開日時なし・下書きあり)。
    return c.json({ success: true, data: { id: item.id, name: item.name, category: item.category, messageType: item.message_type, messageContent: item.message_content, question: questionValue(item.question_json), questionStatus: item.question_status, folderId: item.folder_id ?? null, hasDraft: true, publishedVersion: 0, publishedAt: null, draftRevision: 1, createdAt: item.created_at, updatedAt: item.updated_at } }, 201);
  } catch (err) {
    console.error('POST /api/templates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templates.put('/api/templates/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      category?: string;
      messageType?: string;
      messageContent?: string;
      question?: unknown;
      questionStatus?: 'draft' | 'published';
      folderId?: string | null;
    }>();
    const existing = await getTemplateById(c.env.DB, id);
    if (!existing || !await canAccessAllLineAccounts(
      c.env.DB, c.get('staff'), [existing.line_account_id],
    )) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    /*
     * 347: 保存は2系統。名前・置き場の整理は live 列へ即時反映し、
     * 送信文(種別・本文・カルーセル・質問)は下書きへだけ書く。
     * 公開版は POST /:id/publish を通らないと変わらない。
     */
    const changesMessage = body.messageType !== undefined || body.messageContent !== undefined;
    const touchesCarousel = 'carouselActions' in body
      || 'carouselTapLimitMode' in body
      || 'carouselTapLimitText' in body;
    const touchesQuestion = 'question' in body || body.questionStatus !== undefined;
    const hasContentEdit = changesMessage || touchesCarousel || touchesQuestion;
    // 種別・本文の土台は「編集中の下書きがあればそれ、なければ公開版」。
    // 本文だけ直す場合や、2回目の保存で1回目の下書きへ足す場合がある。
    const baseMessageType = body.messageType
      ?? existing.draft_message_type
      ?? existing.message_type;
    const baseMessageContent = body.messageContent
      ?? existing.draft_message_content
      ?? existing.message_content;
    const message = changesMessage
      ? validateTemplateMessage(baseMessageType, baseMessageContent)
      : { ok: true as const };
    if (!message.ok) {
      const { ok: _ok, ...failure } = message;
      return c.json({ success: false, ...failure }, 422);
    }
    const carousel = checkCarousel(baseMessageType, baseMessageContent);
    if (!carousel.ok) return c.json({ success: false, error: carousel.error }, 422);
    const structured = checkStructuredSize(baseMessageType, baseMessageContent);
    if (!structured.ok) return c.json({ success: false, error: structured.error }, 422);
    const options = readCarouselOptions(body as unknown as Record<string, unknown>);
    if (!options.ok) return c.json({ success: false, error: options.error }, 400);
    const question = readQuestionPayload(body as unknown as Record<string, unknown>);
    if (!question.ok) return c.json({ success: false, error: question.error }, 422);
    if (body.questionStatus && body.questionStatus !== 'draft' && body.questionStatus !== 'published') {
      return c.json({ success: false, error: '質問の保存状態を確認してください' }, 400);
    }
    const folder = await readFolderId(c.env.DB, body as unknown as Record<string, unknown>);
    if (!folder.ok) return c.json({ success: false, error: folder.error }, 422);
    const metadataUpdates: {
      name?: string;
      category?: string;
      folderId?: string | null;
    } = {};
    if (body.name !== undefined) metadataUpdates.name = body.name;
    if (body.category !== undefined) metadataUpdates.category = body.category;
    if (folder.folderId !== undefined) metadataUpdates.folderId = folder.folderId;
    if (Object.keys(metadataUpdates).length > 0) {
      await updateTemplate(c.env.DB, id, metadataUpdates);
    }
    if (hasContentEdit) {
      await saveTemplateDraft(c.env.DB, id, {
        ...(changesMessage
          ? {
              messageType: baseMessageType,
              messageContent: baseMessageContent,
              // 質問を扱わない利用先で選ばれても、壊れたFlexを送らず質問文を送る。
              ...(question.question
                ? { messageType: 'text' as const, messageContent: question.question.intro?.trim() || question.question.text }
                : {}),
            }
          : {}),
        ...options.value,
        questionJson: question.questionJson,
        questionStatus: body.questionStatus,
      });
    }
    const updated = await getTemplateById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: updated.id,
        accountId: updated.line_account_id,
        name: updated.name,
        category: updated.category,
        messageType: draftMessageTypeOf(updated),
        messageContent: draftMessageContentOf(updated),
        question: questionValue(draftQuestionJsonOf(updated)),
        questionStatus: draftQuestionStatusOf(updated),
        folderId: updated.folder_id ?? null,
        carouselActions: draftCarouselActionsOf(updated),
        carouselTapLimitMode: draftCarouselTapLimitModeOf(updated),
        carouselTapLimitText: draftCarouselTapLimitTextOf(updated),
        ...versionInfoOf(updated),
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    });
  } catch (err) {
    console.error('PUT /api/templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

function validPublishKey(value: string | null | undefined): value is string {
  return Boolean(value && value.length >= 8 && value.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(value));
}

/**
 * 347: 下書きを公開版へ写す。送信側が読む live 列はここでしか変わらない。
 * 同じ確認キーでの再試行は成功済みの結果をそのまま返し(下書きなしの成功も記録)、
 * 別の下書きを公開しない。公開版・下書き版の両方を確認できる(自動応答の
 * POST /api/auto-replies/:id/publish より厳しい約束)。
 */
templates.post('/api/templates/:id/publish', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const requestKey = c.req.header('Idempotency-Key');
    if (!validPublishKey(requestKey)) {
      return c.json({ success: false, error: '公開操作の確認キーが必要です' }, 400);
    }
    const existing = await getTemplateById(c.env.DB, id);
    if (!existing || !await canAccessAllLineAccounts(
      c.env.DB, c.get('staff'), [existing.line_account_id],
    )) {
      return c.json({ success: false, error: 'Template not found' }, 404);
    }
    const body: { expectedVersion?: unknown; expectedDraftRevision?: unknown } =
      await c.req.json().catch(() => ({}));
    const expectedVersion = body.expectedVersion === undefined || body.expectedVersion === null
      ? undefined
      : Number(body.expectedVersion);
    if (expectedVersion !== undefined && !Number.isInteger(expectedVersion)) {
      return c.json({ success: false, error: '版の番号を確認してください' }, 400);
    }
    // 差し戻し対応(要件3): 検査したときの下書き版も受け取り、別人による
    // 書き換え後の公開を止める。
    const expectedDraftRevision = body.expectedDraftRevision === undefined || body.expectedDraftRevision === null
      ? undefined
      : Number(body.expectedDraftRevision);
    if (expectedDraftRevision !== undefined && !Number.isInteger(expectedDraftRevision)) {
      return c.json({ success: false, error: '下書きの版を確認してください' }, 400);
    }
    // 公開する版も保存時と同じ検査を通す。下書きは保存時に検査済みだが、
    // 検査基準が変わった後に残った下書きをそのまま出さないため。
    const draftType = existing.draft_message_type ?? existing.message_type;
    const draftContent = existing.draft_message_content ?? existing.message_content;
    if (hasTemplateDraft(existing)) {
      const message = validateTemplateMessage(draftType, draftContent);
      if (!message.ok) {
        const { ok: _ok, ...failure } = message;
        return c.json({ success: false, ...failure }, 422);
      }
      const carousel = checkCarousel(draftType, draftContent);
      if (!carousel.ok) return c.json({ success: false, error: carousel.error }, 422);
      const structured = checkStructuredSize(draftType, draftContent);
      if (!structured.ok) return c.json({ success: false, error: structured.error }, 422);
    }
    const result = await publishTemplate(c.env.DB, id, {
      expectedVersion,
      expectedDraftRevision,
      idempotencyKey: requestKey,
    });
    const row = result.row;
    return c.json({
      success: true,
      data: {
        id: row.id,
        accountId: row.line_account_id,
        messageType: row.message_type,
        messageContent: row.message_content,
        publishedVersion: Number(row.published_version),
        publishedAt: row.published_at,
        published: result.published,
        replayed: result.replayed,
        hasDraft: hasTemplateDraft(row),
        draftRevision: Number(row.draft_revision ?? 0),
      },
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'TEMPLATE_VERSION_CONFLICT') {
      return c.json({ success: false, error: 'ほかの人が先に公開しました。開き直して確認してください' }, 409);
    }
    if (code === 'TEMPLATE_DRAFT_CONFLICT') {
      return c.json({ success: false, error: '下書きが書き換わっています。開き直して確認してください' }, 409);
    }
    console.error('POST /api/templates/:id/publish error:', err);
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
