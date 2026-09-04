import { Hono, type Context } from 'hono';
import {
  getForms,
  getFormsWithStats,
  getFormById,
  getFormAccountIds,
  getFormDeleteImpact,
  formBelongsToLineAccount,
  createForm,
  updateForm,
  archiveFormAtRevision,
  deleteFormAtRevision,
  getFormSubmissions,
  getFormSubmissionsPage,
  getLatestFormSubmission,
  createFormSubmission,
  getFriendByLineUserIdForAccount,
  getFriendById,
  getLineAccountById,
  jstNow,
} from '@line-crm/db';
import { enrollFriendInScenario } from '@line-crm/db';
import { attachTagAndFireSideEffects } from '../services/friend-tag-attach.js';
import { verifyCallerLineIdentity } from '../services/liff-auth.js';
import { pushViaHarnessProxy } from '../services/line-proxy-send.js';
import { dispatchLineProxyLocally } from '../services/local-line-proxy.js';
import { listLimit, listPage } from './list-pagination.js';
import type {
  Form as DbForm,
  FormSubmission as DbFormSubmission,
  FormUsedByAccount,
  Friend as DbFriend,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { resolveLineToken } from '../services/line-token.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { awardActivityMileage } from '../services/activity-mileage.js';
import { dispatchAutomationEventWithLogging } from '../services/automation-triggers.js';
import { applyActionScoreEvent } from '../services/action-score-events.js';
import {
  applyFormLayoutEffects,
  checkFormGates,
} from '../services/form-layout-effects.js';
import {
  collectInputs,
  layoutToFields,
  normalizeLayout,
  parseLayout,
  type FormLayout,
} from '@line-crm/shared';

const forms = new Hono<Env>();

/** 回答に添付できる画像。heic は iPhone の既定の形式なので入れておく。 */
const FORM_UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

const FORM_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const FORM_ARCHIVE_BODY_MAX_BYTES = 16 * 1024;

class FormArchiveBodyError extends Error {
  constructor(readonly status: 400 | 413, message: string) {
    super(message);
  }
}

/** 小さい確認本文でも、宣言値と実際に読んだ量の両方へ上限を置く。 */
async function readBoundedFormArchiveBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declared) && declared > FORM_ARCHIVE_BODY_MAX_BYTES) {
    throw new FormArchiveBodyError(413, '送信内容が大きすぎます');
  }
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > FORM_ARCHIVE_BODY_MAX_BYTES) {
      await reader.cancel();
      throw new FormArchiveBodyError(413, '送信内容が大きすぎます');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new FormArchiveBodyError(400, '送信内容を読み取れませんでした');
  }
}

/** フォームの項目定義。forms.fields は JSON の配列で持っている。 */
interface FormFieldDef {
  id?: string;
  name?: string;
  label?: string;
  type?: string;
  /** 回答の登録先。友だち情報欄の項目ID。未設定なら情報欄には書かない */
  friendFieldId?: string | null;
}

/**
 * forms.fields を読む。
 *
 * 壊れていても空配列を返す。ここで例外を投げると、項目定義が1つ壊れた
 * だけでフォームの送信そのものが失敗する。
 */
function parseFormFields(raw: string | null | undefined): FormFieldDef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as FormFieldDef[]) : [];
  } catch {
    return [];
  }
}

function optionalExecutionCtx(c: Context<Env>): ExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    // Hono unit tests do not provide a Workers ExecutionContext.
    return undefined;
  }
}

async function resolveFriendAccessToken(
  db: D1Database,
  friend: DbFriend,
  defaultAccessToken: string,
  context: string,
): Promise<string> {
  const accountId = friend.line_account_id ?? null;
  if (!accountId) return resolveLineToken({ accountToken: null, defaultToken: defaultAccessToken, accountId: null, context });
  const account = await getLineAccountById(db, accountId);
  return resolveLineToken({ accountToken: account?.channel_access_token, defaultToken: defaultAccessToken, accountId, context });
}

function serializeForm(
  row: DbForm,
  extra?: {
    lastSubmittedAt?: string | null;
    usedByAccounts?: FormUsedByAccount[];
    accountScopeReviewRequired?: boolean;
  },
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    fields: JSON.parse(row.fields || '[]') as unknown[],
    layout: parseLayout(row.layout, row.fields),
    onSubmitTagId: row.on_submit_tag_id,
    onSubmitScenarioId: row.on_submit_scenario_id,
    onSubmitMessageType: row.on_submit_message_type,
    onSubmitMessageContent: row.on_submit_message_content,
    onSubmitWebhookUrl: row.on_submit_webhook_url,
    onSubmitWebhookHeaders: row.on_submit_webhook_headers,
    onSubmitWebhookFailMessage: row.on_submit_webhook_fail_message,
    saveToMetadata: Boolean(row.save_to_metadata),
    isActive: Boolean(row.is_active),
    status: row.status,
    archivedAt: row.archived_at,
    revision: row.revision,
    submitCount: row.submit_count,
    ogTitle: row.og_title,
    ogDescription: row.og_description,
    ogImageUrl: row.og_image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSubmittedAt: extra?.lastSubmittedAt ?? null,
    usedByAccounts: extra?.usedByAccounts ?? [],
    accountScopeReviewRequired: extra?.accountScopeReviewRequired ?? false,
  };
}

async function canUseFormFromAccount(
  c: Context<Env>,
  formId: string,
  accountId: string | undefined,
): Promise<boolean> {
  if (!accountId) return false;
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) return false;
  return formBelongsToLineAccount(c.env.DB, formId, accountId);
}

/** 選択中だけでなく、フォームが所属する全アカウントを扱える人だけが実行する。 */
async function authorizedDeleteImpact(
  c: Context<Env>,
  formId: string,
  accountId: string,
) {
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return { kind: 'not_found' as const };
  }
  const impact = await getFormDeleteImpact(c.env.DB, formId, accountId);
  if (!impact) return { kind: 'not_found' as const };
  const allAccountIds = await getFormAccountIds(c.env.DB, formId);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), allAccountIds)) {
    return { kind: 'forbidden' as const };
  }
  return { kind: 'ready' as const, impact };
}

function publicWebhookConfig(row: DbForm): {
  hasSubmitWebhook: boolean;
  webhookOrigin: string | null;
  webhookGateId: string | null;
} {
  if (!row.on_submit_webhook_url) {
    return { hasSubmitWebhook: false, webhookOrigin: null, webhookGateId: null };
  }

  try {
    const url = new URL(row.on_submit_webhook_url);
    const gateMatch = url.pathname.match(/\/engagement-gates\/([^/]+)\/verify\/?$/);
    return {
      hasSubmitWebhook: true,
      // The LIFF client needs the service origin for its public replier/verify
      // UX. Never expose the stored path, query string, or secret headers.
      webhookOrigin: url.origin,
      webhookGateId: gateMatch ? decodeURIComponent(gateMatch[1]) : null,
    };
  } catch {
    return { hasSubmitWebhook: true, webhookOrigin: null, webhookGateId: null };
  }
}

function serializePublicForm(row: DbForm) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    fields: JSON.parse(row.fields || '[]') as unknown[],
    layout: parseLayout(row.layout, row.fields),
    isActive: Boolean(row.is_active),
    onSubmitMessageContent: row.on_submit_message_content,
    onSubmitWebhookFailMessage: row.on_submit_webhook_fail_message,
    ...publicWebhookConfig(row),
  };
}

function serializeSubmission(row: DbFormSubmission & { friend_name?: string | null }) {
  return {
    id: row.id,
    formId: row.form_id,
    friendId: row.friend_id,
    friendName: row.friend_name || null,
    data: JSON.parse(row.data || '{}') as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

/**
 * 受け取った layout を、保存できる形にそろえる。
 *
 * 外から来た JSON をそのまま入れない。形を正した上で、互換用の `fields`
 * も同時に作り直す。`fields` はいまも送信時の必須チェックと回答一覧の
 * 見出しが読んでいて、layout だけ更新すると両者がずれる。
 */
function normalizeLayoutInput(raw: unknown): { layout: string; fields: string } | null {
  const layout = normalizeLayout(raw);
  if (!layout) return null;
  return {
    layout: JSON.stringify(layout),
    fields: JSON.stringify(layoutToFields(layout)),
  };
}

// GET /api/forms — list all forms (with submission stats + delivering accounts)
forms.get('/api/forms', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('account_id');
    if (!accountId) {
      return c.json({ success: false, error: 'account_id is required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const items = await getFormsWithStats(c.env.DB, { lineAccountIds: [accountId] });
    return c.json({
      success: true,
      data: items.map((row) =>
        serializeForm(row, {
          lastSubmittedAt: row.last_submitted_at,
          usedByAccounts: row.used_by_accounts,
          accountScopeReviewRequired: row.account_scope_review_required,
        }),
      ),
    });
  } catch (err) {
    console.error('GET /api/forms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id — get form
forms.get('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const staff = c.get('staff');
    if (staff && !await canUseFormFromAccount(c, id, c.req.query('account_id'))) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const data = staff ? serializeForm(form) : serializePublicForm(form);
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms — create form
forms.post('/api/forms', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string | null;
      fields?: unknown[];
      layout?: unknown;
      onSubmitTagId?: string | null;
      onSubmitScenarioId?: string | null;
      onSubmitMessageType?: 'text' | 'flex' | null;
      onSubmitMessageContent?: string | null;
      onSubmitWebhookUrl?: string | null;
      onSubmitWebhookHeaders?: string | null;
      onSubmitWebhookFailMessage?: string | null;
      saveToMetadata?: boolean;
      ogTitle?: string | null;
      ogDescription?: string | null;
      ogImageUrl?: string | null;
      accountId?: string;
    }>();

    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }
    if (!body.accountId) {
      return c.json({ success: false, error: 'accountId is required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }

    const normalized = body.layout !== undefined ? normalizeLayoutInput(body.layout) : null;

    const form = await createForm(c.env.DB, {
      name: body.name,
      description: body.description ?? null,
      fields: normalized ? normalized.fields : JSON.stringify(body.fields ?? []),
      layout: normalized ? normalized.layout : null,
      onSubmitTagId: body.onSubmitTagId ?? null,
      onSubmitScenarioId: body.onSubmitScenarioId ?? null,
      onSubmitMessageType: body.onSubmitMessageType ?? null,
      onSubmitMessageContent: body.onSubmitMessageContent ?? null,
      onSubmitWebhookUrl: body.onSubmitWebhookUrl ?? null,
      onSubmitWebhookHeaders: body.onSubmitWebhookHeaders ?? null,
      onSubmitWebhookFailMessage: body.onSubmitWebhookFailMessage ?? null,
      saveToMetadata: body.saveToMetadata,
      ogTitle: body.ogTitle ?? null,
      ogDescription: body.ogDescription ?? null,
      ogImageUrl: body.ogImageUrl ?? null,
      lineAccountIds: [body.accountId],
    });

    return c.json({ success: true, data: serializeForm(form) }, 201);
  } catch (err) {
    console.error('POST /api/forms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/drafts — 公開されていない空の下書きを作り、編集画面へ進む。
forms.post('/api/forms/drafts', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name?: string; accountId?: string }>()
      .catch(() => ({} as { name?: string; accountId?: string }));
    if (!body.accountId) {
      return c.json({ success: false, error: 'accountId is required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const form = await createForm(c.env.DB, {
      name: body.name?.trim() || '名称未設定のフォーム',
      fields: '[]',
      layout: null,
      isActive: false,
      lineAccountIds: [body.accountId],
    });
    return c.json({ success: true, data: serializeForm(form) }, 201);
  } catch (err) {
    console.error('POST /api/forms/drafts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/forms/:id — update form
forms.put('/api/forms/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!await canUseFormFromAccount(c, id, c.req.query('account_id'))) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      fields?: unknown[];
      layout?: unknown;
      onSubmitTagId?: string | null;
      onSubmitScenarioId?: string | null;
      onSubmitMessageType?: 'text' | 'flex' | null;
      onSubmitMessageContent?: string | null;
      onSubmitWebhookUrl?: string | null;
      onSubmitWebhookHeaders?: string | null;
      onSubmitWebhookFailMessage?: string | null;
      saveToMetadata?: boolean;
      isActive?: boolean;
      ogTitle?: string | null;
      ogDescription?: string | null;
      ogImageUrl?: string | null;
    }>();

    // Only include fields that were explicitly sent (avoid undefined → null conversion)
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.fields !== undefined) updates.fields = JSON.stringify(body.fields);
    // layout を受け取ったときは、fields もそこから作り直す。片方だけ新しい
    // 状態にすると、送信時の必須チェックが古い項目を見に行く。
    if (body.layout !== undefined) {
      const normalized = normalizeLayoutInput(body.layout);
      if (!normalized) {
        return c.json({ success: false, error: 'layout の形が正しくありません' }, 400);
      }
      updates.layout = normalized.layout;
      updates.fields = normalized.fields;
    }
    if (body.onSubmitTagId !== undefined) updates.onSubmitTagId = body.onSubmitTagId;
    if (body.onSubmitScenarioId !== undefined) updates.onSubmitScenarioId = body.onSubmitScenarioId;
    if (body.onSubmitMessageType !== undefined) updates.onSubmitMessageType = body.onSubmitMessageType;
    if (body.onSubmitMessageContent !== undefined) updates.onSubmitMessageContent = body.onSubmitMessageContent;
    if (body.onSubmitWebhookUrl !== undefined) updates.onSubmitWebhookUrl = body.onSubmitWebhookUrl;
    if (body.onSubmitWebhookHeaders !== undefined) updates.onSubmitWebhookHeaders = body.onSubmitWebhookHeaders;
    if (body.onSubmitWebhookFailMessage !== undefined) updates.onSubmitWebhookFailMessage = body.onSubmitWebhookFailMessage;
    if (body.saveToMetadata !== undefined) updates.saveToMetadata = body.saveToMetadata;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.ogTitle !== undefined) updates.ogTitle = body.ogTitle;
    if (body.ogDescription !== undefined) updates.ogDescription = body.ogDescription;
    if (body.ogImageUrl !== undefined) updates.ogImageUrl = body.ogImageUrl;

    const updated = await updateForm(c.env.DB, id, updates as any);

    if (!updated) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }

    return c.json({ success: true, data: serializeForm(updated) });
  } catch (err) {
    console.error('PUT /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id/delete-impact — 回答・利用先・開けなくなるURLを同時に確認する。
forms.get('/api/forms/:id/delete-impact', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('account_id')?.trim();
    if (!accountId) return c.json({ success: false, error: 'account_id is required' }, 400);
    const authorized = await authorizedDeleteImpact(c, c.req.param('id'), accountId);
    if (authorized.kind === 'not_found') {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    if (authorized.kind === 'forbidden') {
      return c.json({ success: false, error: 'すべての利用先を確認する権限がありません' }, 403);
    }
    return c.json({ success: true, data: authorized.impact });
  } catch (error) {
    console.error('GET /api/forms/:id/delete-impact error:', error);
    return c.json({ success: false, error: '削除したときの影響を確認できませんでした' }, 503);
  }
});

// POST /api/forms/:id/archive — 公開を止め、回答と利用先を残して保管する。
forms.post('/api/forms/:id/archive', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('account_id')?.trim();
    if (!accountId) return c.json({ success: false, error: 'account_id is required' }, 400);
    const body = await readBoundedFormArchiveBody(c.req.raw);
    const expectedRevision = typeof body.expectedRevision === 'number'
      ? body.expectedRevision
      : Number.NaN;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return c.json({ success: false, error: '確認した版が必要です' }, 400);
    }

    const authorized = await authorizedDeleteImpact(c, c.req.param('id'), accountId);
    if (authorized.kind === 'not_found') {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    if (authorized.kind === 'forbidden') {
      return c.json({ success: false, error: 'すべての利用先を確認する権限がありません' }, 403);
    }
    if (authorized.impact.revision !== expectedRevision) {
      return c.json({
        success: false,
        error: 'form_delete_changed',
        message: '影響が変わりました。最新の状態を読み直してください。',
        data: authorized.impact,
      }, 409);
    }
    if (!authorized.impact.canArchive) {
      return c.json({
        success: false,
        error: 'form_already_archived',
        message: 'この回答フォームはすでに保管されています。',
        data: authorized.impact,
      }, 409);
    }

    const archived = await archiveFormAtRevision(c.env.DB, c.req.param('id'), expectedRevision);
    if (!archived) {
      const latest = await getFormDeleteImpact(c.env.DB, c.req.param('id'), accountId);
      return c.json({
        success: false,
        error: 'form_delete_changed',
        message: '影響が変わりました。最新の状態を読み直してください。',
        data: latest,
      }, 409);
    }
    return c.json({
      success: true,
      data: {
        status: 'archived',
        archivedAt: archived.archived_at,
        retainedSubmissionCount: authorized.impact.submissionCount,
        retainedOpenCount: authorized.impact.openCount,
        retainedReferenceCount: authorized.impact.referenceCount,
        answerUrlUnavailable: true,
      },
    });
  } catch (error) {
    if (error instanceof FormArchiveBodyError) {
      return c.json({ success: false, error: error.message }, error.status);
    }
    console.error('POST /api/forms/:id/archive error:', error);
    return c.json({ success: false, error: '回答フォームを保管できませんでした' }, 503);
  }
});

// DELETE /api/forms/:id — 影響0件・非公開・同じ版のときだけ物理削除する。
forms.delete('/api/forms/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const accountId = c.req.query('account_id')?.trim();
    const expectedRevision = Number(c.req.query('expected_revision'));
    if (!accountId) return c.json({ success: false, error: 'account_id is required' }, 400);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return c.json({ success: false, error: '確認した版が必要です' }, 400);
    }
    const authorized = await authorizedDeleteImpact(c, id, accountId);
    if (authorized.kind === 'not_found') {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    if (authorized.kind === 'forbidden') {
      return c.json({ success: false, error: 'すべての利用先を確認する権限がありません' }, 403);
    }
    if (authorized.impact.revision !== expectedRevision) {
      return c.json({
        success: false,
        error: 'form_delete_changed',
        message: '影響が変わりました。最新の状態を読み直してください。',
        data: authorized.impact,
      }, 409);
    }
    if (!authorized.impact.canDelete) {
      return c.json({
        success: false,
        error: 'form_archive_required',
        message: '公開中、回答あり、または利用中のため、削除せず停止・保管してください。',
        data: authorized.impact,
      }, 409);
    }
    if (!await deleteFormAtRevision(c.env.DB, id, expectedRevision)) {
      const latest = await getFormDeleteImpact(c.env.DB, id, accountId);
      return c.json({
        success: false,
        error: 'form_delete_changed',
        message: '影響が変わりました。最新の状態を読み直してください。',
        data: latest,
      }, 409);
    }
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/forms/:id error:', err);
    return c.json({ success: false, error: '削除したときの影響を確認できませんでした' }, 503);
  }
});

// GET /api/forms/:id/submissions — list submissions
forms.get('/api/forms/:id/submissions', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const id = c.req.param('id');
    if (!await canUseFormFromAccount(c, id, c.req.query('account_id'))) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const hasPagination = c.req.query('page') !== undefined || c.req.query('limit') !== undefined;
    if (!hasPagination) {
      // SDKなど既存利用先との互換性を保つ。V6管理画面だけが明示的にページ分けを要求する。
      const submissions = await getFormSubmissions(c.env.DB, id);
      return c.json({ success: true, data: submissions.map(serializeSubmission) });
    }
    const page = listPage(c.req.query('page'));
    const limit = listLimit(c.req.query('limit'), 20);
    const submissions = await getFormSubmissionsPage(c.env.DB, id, { page, limit });
    return c.json({
      success: true,
      data: {
        items: submissions.items.map(serializeSubmission),
        total: submissions.total,
        page: submissions.page,
        limit: submissions.limit,
      },
    });
  } catch (err) {
    console.error('GET /api/forms/:id/submissions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/:id/opened — record form open event (public, used by LIFF)
forms.post('/api/forms/:id/opened', async (c) => {
  try {
    const formId = c.req.param('id');
    // 保管後のURLは開けない。回答だけでなく「開いた記録」も増やさない。
    if (!await getFormById(c.env.DB, formId)) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    // Open analytics may remain anonymous, but a caller can only attribute an
    // open to the LINE identity proven by its ID token. Body-supplied customer
    // IDs are intentionally ignored.
    const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
    if (identity && (!identity.lineAccountId
      || !await formBelongsToLineAccount(c.env.DB, formId, identity.lineAccountId))) {
      // 関係のない公式アカウントから開いた記録を、このフォームへ混ぜない。
      return c.json({ success: true });
    }
    const friend = identity
      ? await getFriendByLineUserIdForAccount(
          c.env.DB,
          identity.lineUserId,
          identity.lineAccountId,
        )
      : null;

    const now = jstNow();
    await c.env.DB.prepare(
      'INSERT INTO form_opens (id, form_id, friend_id, friend_name, opened_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      formId,
      friend?.id ?? null,
      friend?.display_name ?? null,
      now,
    ).run();

    return c.json({ success: true });
  } catch (err) {
    console.error('POST /api/forms/:id/opened error:', err);
    return c.json({ success: true }); // non-blocking, always succeed
  }
});

// POST /api/forms/:id/partial — save survey answers without x_username (public, used by LIFF page 1)
forms.post('/api/forms/:id/partial', async (c) => {
  try {
    const body = await c.req.json<{ data?: Record<string, unknown> }>();
    const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
    if (!identity) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (!identity.lineAccountId
      || !await formBelongsToLineAccount(c.env.DB, c.req.param('id'), identity.lineAccountId)) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }

    const friend = await getFriendByLineUserIdForAccount(
      c.env.DB,
      identity.lineUserId,
      identity.lineAccountId,
    );

    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    // Save survey data to friend metadata (merge with existing)
    const existingMeta = friend.metadata ? JSON.parse(friend.metadata) : {};
    const merged = { ...existingMeta, ...body.data };
    await c.env.DB.prepare(
      'UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?',
    ).bind(JSON.stringify(merged), jstNow(), friend.id).run();

    return c.json({ success: true });
  } catch (err) {
    console.error('POST /api/forms/:id/partial error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/forms/:id/files — 回答に添付する画像を預かる（回答画面から使う）
 *
 * 友だちが送ってくるので、スタッフ用の `/api/images` は使えない。本人確認は
 * LIFF の id_token で行う。
 *
 * 誰でも投げられる口にしないため、次を満たしたときだけ受け取る。
 *
 *   - id_token で本人が特定できる（＝この公式アカウントの友だち）
 *   - フォームが公開中である
 *   - そのフォームに、実際にファイルを受け取るブロックがある
 *
 * 3つ目が無いと、フォームIDさえ知っていれば誰でも画像置き場として使える。
 */
forms.post('/api/forms/:id/files', async (c) => {
  try {
    const formId = c.req.param('id');
    const form = await getFormById(c.env.DB, formId);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if (!form.is_active) {
      return c.json({ success: false, error: 'このフォームは受け付けていません' }, 400);
    }

    const layout = parseLayout(form.layout, form.fields);
    const acceptsFile = collectInputs(layout).some((block) => block.type === 'file');
    if (!acceptsFile) {
      return c.json({ success: false, error: 'このフォームはファイルを受け付けていません' }, 400);
    }

    const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
    if (!identity) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (!identity.lineAccountId
      || !await formBelongsToLineAccount(c.env.DB, formId, identity.lineAccountId)) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const friend = await getFriendByLineUserIdForAccount(
      c.env.DB,
      identity.lineUserId,
      identity.lineAccountId,
    );
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const mimeType = (c.req.header('Content-Type') || '').split(';')[0].trim();
    const extension = FORM_UPLOAD_TYPES[mimeType];
    if (!extension) {
      return c.json(
        { success: false, error: '画像は jpg・png・gif・webp・heic のいずれかで送ってください' },
        400,
      );
    }

    // 本文を読む前に、申告された長さで断れるものは断る。10MBを読み込んでから
    // 大きすぎると返すのは、相手の通信量を無駄に使う。
    const declared = Number(c.req.header('Content-Length') || 0);
    if (declared > FORM_UPLOAD_MAX_BYTES) {
      return c.json({ success: false, error: '画像は10MBまでです' }, 400);
    }

    const data = await c.req.arrayBuffer();
    if (data.byteLength === 0) {
      return c.json({ success: false, error: 'ファイルが空です' }, 400);
    }
    if (data.byteLength > FORM_UPLOAD_MAX_BYTES) {
      return c.json({ success: false, error: '画像は10MBまでです' }, 400);
    }

    // 誰の・どのフォームの添付かが、キーを見れば分かるようにしておく。
    // 削除依頼が来たときに、消す対象をキーの形だけで絞り込める。
    const key = `form-uploads/${formId}/${friend.id}/${crypto.randomUUID()}.${extension}`;
    await c.env.IMAGES.put(key, data, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { formId, friendId: friend.id },
    });

    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    return c.json(
      { success: true, data: { key, url: `${workerUrl}/images/${key}`, mimeType, size: data.byteLength } },
      201,
    );
  } catch (err) {
    console.error('POST /api/forms/:id/files error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/forms/:id/my-latest — 前回の自分の回答（回答画面から使う）
 *
 * オプションの「前回の回答を復元する」を入れているフォームだけが返す。
 * 入れていないフォームで前の回答を返すと、本人が消したつもりの値が
 * 別の端末で復活して見える。
 */
forms.get('/api/forms/:id/my-latest', async (c) => {
  try {
    const formId = c.req.param('id');
    const form = await getFormById(c.env.DB, formId);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }

    const layout = parseLayout(form.layout, form.fields);
    if (!layout.options?.restorePrevious) {
      return c.json({ success: true, data: null });
    }

    const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
    if (!identity) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (!identity.lineAccountId
      || !await formBelongsToLineAccount(c.env.DB, formId, identity.lineAccountId)) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const friend = await getFriendByLineUserIdForAccount(
      c.env.DB,
      identity.lineUserId,
      identity.lineAccountId,
    );
    if (!friend) {
      return c.json({ success: true, data: null });
    }

    const latest = await getLatestFormSubmission(c.env.DB, formId, friend.id);
    if (!latest) {
      return c.json({ success: true, data: null });
    }

    let answers: Record<string, unknown> = {};
    try {
      answers = JSON.parse(latest.data || '{}') as Record<string, unknown>;
    } catch {
      answers = {};
    }
    return c.json({ success: true, data: { answers, createdAt: latest.created_at } });
  } catch (err) {
    console.error('GET /api/forms/:id/my-latest error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/:id/submit — submit form (public, used by LIFF)
forms.post('/api/forms/:id/submit', async (c) => {
  try {
    const formId = c.req.param('id');
    const form = await getFormById(c.env.DB, formId);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if (!form.is_active) {
      return c.json({ success: false, error: 'This form is no longer accepting responses' }, 400);
    }

    const body = await c.req.json<{
      data?: Record<string, unknown>;
      trackedLinkId?: string;
    }>();

    const submissionData = body.data ?? {};

    const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
    if (!identity) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (!identity.lineAccountId
      || !await formBelongsToLineAccount(c.env.DB, formId, identity.lineAccountId)) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const friend = await getFriendByLineUserIdForAccount(
      c.env.DB,
      identity.lineUserId,
      identity.lineAccountId,
    );
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }
    const friendId = friend.id;

    // 受け付けてよいかを見る。
    //
    // layout を持つフォームは、必須だけでなく入力制限・選択数・回答期限・
    // 1人1回・総数・選択肢の定員まで、ここで断る。断る理由はそのまま
    // 回答画面に出るので、日本語で返す。
    //
    // layout が無い（昔のまま編集していない）フォームは、これまでどおり
    // fields の必須だけを見る。
    const layout: FormLayout | null = form.layout ? parseLayout(form.layout) : null;

    if (layout) {
      const rejected = await checkFormGates({
        db: c.env.DB,
        formId,
        layout,
        friendId,
        submitCount: form.submit_count ?? 0,
        answers: submissionData,
      });
      if (rejected) {
        return c.json({ success: false, error: rejected }, 400);
      }
    } else {
      const fields = JSON.parse(form.fields || '[]') as Array<{
        name: string;
        label: string;
        type: string;
        required?: boolean;
      }>;

      for (const field of fields) {
        if (field.required) {
          const val = submissionData[field.name];
          if (val === undefined || val === null || val === '') {
            return c.json(
              { success: false, error: `${field.label} は必須項目です` },
              400,
            );
          }
        }
      }
    }

    // Browser-side verification is UX only. The server always performs the
    // authoritative webhook check; client-supplied skip flags are discarded.
    delete submissionData._webhookVerified;
    delete submissionData._skipWebhook;
    let webhookData: Record<string, unknown> | null = null;
    if (form.on_submit_webhook_url) {
      const webhookResult = await callFormWebhook(form, submissionData);
      webhookData = webhookResult.data as Record<string, unknown> | null;
      if (!webhookResult.passed) {
        // Webhook rejected — send fail message and stop
        if (form.on_submit_webhook_fail_message) {
          if (friend.line_user_id) {
            try {
              const accessToken = await resolveFriendAccessToken(
                c.env.DB,
                friend,
                c.env.LINE_CHANNEL_ACCESS_TOKEN,
                'forms.webhook-failure-send',
              );
              await pushViaHarnessProxy(
                new URL(c.req.url).origin,
                accessToken,
                friend.line_user_id,
                [{ type: 'text', text: form.on_submit_webhook_fail_message }],
                crypto.randomUUID(),
                (request) => dispatchLineProxyLocally(request, c.env, optionalExecutionCtx(c)),
              );
            } catch (e) {
              console.error('Failed to send webhook fail message:', e);
            }
          }
        }
        // Still save the submission for records
        const submission = await createFormSubmission(c.env.DB, {
          formId,
          friendId,
          data: JSON.stringify({ ...submissionData, _webhookResult: webhookResult.data }),
        });
        return c.json({ success: true, data: { ...serializeSubmission(submission), webhookPassed: false, webhookData: webhookResult.data } }, 201);
      }
    }

    // Save submission against the authenticated caller only.
    const submission = await createFormSubmission(c.env.DB, {
      formId,
      friendId,
      data: JSON.stringify(submissionData),
    });

    await awardActivityMileage(c.env.DB, {
      eventType: 'form_submitted',
      source: 'form',
      sourceEventId: submission.id,
      friendId,
      subjectKey: formId,
      metadata: { formId, formName: form.name },
      occurredAt: submission.created_at,
    });

    const executionCtx = optionalExecutionCtx(c);
    if (executionCtx && identity.lineAccountId) executionCtx.waitUntil(
      Promise.allSettled([
        applyActionScoreEvent(c.env.DB, {
          lineAccountId: identity.lineAccountId,
          friendId,
          eventType: 'form_submitted',
          source: 'form',
          sourceEventId: submission.id,
          subjectKey: formId,
          occurredAt: submission.created_at,
        }),
        dispatchAutomationEventWithLogging(c.env.DB, {
          lineAccountId: identity.lineAccountId,
          eventType: 'form_submitted',
          sourceEventId: submission.id,
          friendId,
          eventData: { formId, submissionId: submission.id },
        }),
      ]).then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') console.error('form action event failed:', result.reason);
        }
      }),
    );

    // Side effects (best-effort, don't fail the request)
    {
      const db = c.env.DB;
      const now = jstNow();

      // Resolve reward template per-campaign.
      //
      // Priority:
      //   1. body.trackedLinkId (= ?ref= from /r/:ref → LIFF → form). This lets
      //      X Harness campaign settings drive the reward, even for friends who
      //      were originally added via a different campaign.
      //   2. Fallback to friends.first_tracked_link_id (first-touch attribution)
      //      so existing tracked links without ref pass-through still work.
      //
      // This OVERRIDES form.on_submit_message_*.
      //
      // Note: anti-replay (preventing the same friend from claiming the same
      // reward twice via URL tampering) is intentionally NOT enforced. The
      // product is opt-in oriented and the engagement gate handles real
      // anti-fraud upstream.
      let rewardTemplate: import('@line-crm/db').MessageTemplate | null = null;
      {
        const { getFriendById, getTrackedLinkById, getMessageTemplateById } = await import('@line-crm/db');
        const { resolveRewardTemplate } = await import('../services/reward-resolver.js');
        rewardTemplate = await resolveRewardTemplate(
          db,
          {
            friendId,
            requestedTrackedLinkId: body.trackedLinkId ?? null,
          },
          { getFriendById, getTrackedLinkById, getMessageTemplateById },
        );
      }

      const sideEffects: Promise<unknown>[] = [];

      // Save response data to friend's metadata
      if (form.save_to_metadata) {
        sideEffects.push(
          (async () => {
            const friend = await getFriendById(db, friendId!);
            if (!friend) return;
            const existing = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
            const merged = { ...existing, ...submissionData };
            await db
              .prepare(`UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?`)
              .bind(JSON.stringify(merged), now, friendId)
              .run();
          })(),
        );
      }

      // layout を持つフォームは、こちらで回答を配る。
      //
      // 登録先（情報欄・本名・システム表示名・個別メモ）、選択肢ごとの
      // タグ／情報欄／動作、日付から動かすリマインダ、回答後の動作までを
      // まとめて実行する。失敗しても送信は成功のまま（保存は済んでいる）。
      if (layout) {
        sideEffects.push(
          applyFormLayoutEffects({
            db,
            layout,
            friendId: friendId!,
            answers: submissionData,
            push: {
              defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
              workerUrl: c.env.WORKER_URL,
            },
            pushText: async (text: string) => {
              const target = await getFriendById(db, friendId!);
              if (!target?.line_user_id) return;
              const accessToken = await resolveFriendAccessToken(
                db,
                target,
                c.env.LINE_CHANNEL_ACCESS_TOKEN,
                'forms.layout-text-send',
              );
              await pushViaHarnessProxy(
                new URL(c.req.url).origin,
                accessToken,
                target.line_user_id,
                [{ type: 'text', text }],
                crypto.randomUUID(),
                (request) => dispatchLineProxyLocally(request, c.env, optionalExecutionCtx(c)),
              );
            },
          }).catch((err) => console.error('form layout effects failed:', err)),
        );
      }

      // 回答を友だち情報欄へ書く。
      //
      // フォームの項目に friendFieldId を持たせておくと、その項目の回答が
      // 友だち情報欄に入る。ここが「フォーム → 情報欄 → 友だち詳細 →
      // テンプレートの差し込み」の線をつなぐ一点。
      //
      // metadata への保存とは別に持つ。metadata は形が決まっていない
      // 置き場で、情報欄は型と差し込み名を持つ。両方に入れておけば、
      // 既存の {{metadata.KEY}} を使っているテンプレートも壊れない。
      sideEffects.push(
        (async () => {
          // layout があるときは applyFormLayoutEffects が書くので、ここは
          // 動かさない。同じ値を2回書いても結果は同じだが、ECが正かどうかの
          // 判定を2度走らせるだけ無駄になる。
          if (layout) return;
          const formFields = parseFormFields(form.fields);
          const targets = formFields.filter((f) => f.friendFieldId);
          if (targets.length === 0) return;
          const { setFriendFieldValue, getFriendFieldById } = await import('@line-crm/db');
          for (const field of targets) {
            const answer = submissionData[field.name ?? field.id ?? ''];
            if (answer === undefined) continue;
            // ECが正の項目には書かない。フォームの回答で上書きすると、
            // 次のEC同期で戻り、入れたはずの値が消えたように見える。
            const target = await getFriendFieldById(db, field.friendFieldId!);
            if (!target || target.ec_is_master === 1) continue;
            await setFriendFieldValue(db, {
              friendId: friendId!,
              fieldId: field.friendFieldId!,
              value:
                answer == null
                  ? null
                  : Array.isArray(answer)
                    ? answer.join(', ')
                    : String(answer),
              updatedBy: 'form',
            });
          }
        })().catch((err) => console.error('form -> friend_fields failed:', err)),
      );

      // Add tag — guarded attach so a tag_added-triggered scenario fires on
      // first-time submit (and never re-fires on duplicate submits).
      if (form.on_submit_tag_id) {
        sideEffects.push(attachTagAndFireSideEffects(db, friendId, form.on_submit_tag_id, {
          defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
          workerUrl: c.env.WORKER_URL,
        }));
      }

      // Enroll in scenario
      if (form.on_submit_scenario_id) {
        sideEffects.push(enrollFriendInScenario(db, friendId, form.on_submit_scenario_id));
      }

      // If webhook returned a join_url (e.g. Meet Harness), send a Flex button to the user
      if (webhookData?.join_url) {
        sideEffects.push(
          (async () => {
            const friend = await getFriendById(db, friendId!);
            if (!friend?.line_user_id) return;
            const accessToken = await resolveFriendAccessToken(
              db,
              friend,
              c.env.LINE_CHANNEL_ACCESS_TOKEN,
              'forms.meet-link-send',
            );
            const joinUrl = String(webhookData!.join_url);
            const meetFlex = {
              type: 'bubble',
              header: {
                type: 'box', layout: 'vertical',
                contents: [
                  { type: 'text', text: 'ヒアリングの準備ができました', size: 'md', weight: 'bold', color: '#1e293b' },
                ],
                paddingAll: '20px', backgroundColor: '#f0f9ff',
              },
              body: {
                type: 'box', layout: 'vertical',
                contents: [
                  { type: 'text', text: 'アンケートありがとうございます。続けて短いヒアリングにご協力ください。', size: 'sm', color: '#475569', wrap: true },
                ],
                paddingAll: '20px',
              },
              footer: {
                type: 'box', layout: 'vertical',
                contents: [
                  {
                    type: 'button', style: 'primary', color: '#4CAF50',
                    action: { type: 'uri', label: 'ヒアリングを始める', uri: joinUrl },
                  },
                ],
                paddingAll: '16px',
              },
            };
            await pushViaHarnessProxy(
              new URL(c.req.url).origin,
              accessToken,
              friend.line_user_id,
              [{ type: 'flex', altText: 'ヒアリングの準備ができました', contents: meetFlex }],
              crypto.randomUUID(),
              (request) => dispatchLineProxyLocally(request, c.env, optionalExecutionCtx(c)),
            );
          })(),
        );
      }

      // Send confirmation message with submitted data back to user
      sideEffects.push(
        (async () => {
          console.log('Form reply: starting for friendId', friendId);
          const friend = await getFriendById(db, friendId!);
          if (!friend?.line_user_id) { console.log('Form reply: no LINE recipient'); return; }
          console.log('Form reply: sending');
          const accessToken = await resolveFriendAccessToken(
            db,
            friend,
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            'forms.reply-send',
          );
          const { buildMessage, expandVariables } = await import('../services/step-delivery.js');
          const apiOrigin = new URL(c.req.url).origin;
          const { resolveMetadata } = await import('../services/step-delivery.js');
          const resolvedMeta = await resolveMetadata(c.env.DB, { user_id: (friend as unknown as Record<string, string | null>).user_id, metadata: (friend as unknown as Record<string, string | null>).metadata });
          const friendData = {
            id: friend.id,
            display_name: friend.display_name,
            user_id: (friend as unknown as Record<string, string | null>).user_id,
            ref_code: (friend as unknown as Record<string, string | null>).ref_code,
            metadata: resolvedMeta,
          };

          // Build diagnostic result Flex card showing their answers
          const entries = Object.entries(submissionData as Record<string, unknown>);
          const answerRows = entries.map(([key, value]) => {
            const field = form.fields ? (JSON.parse(form.fields) as Array<{ name: string; label: string }>).find((f: { name: string }) => f.name === key) : null;
            const label = field?.label || key;
            const val = Array.isArray(value) ? value.join(', ') : (value !== null && value !== undefined && value !== '') ? String(value) : '-';
            return {
              type: 'box' as const, layout: 'vertical' as const, margin: 'md' as const,
              contents: [
                { type: 'text' as const, text: label, size: 'xxs' as const, color: '#64748b' },
                { type: 'text' as const, text: val, size: 'sm' as const, color: '#1e293b', weight: 'bold' as const, wrap: true },
              ],
            };
          });

          const resultFlex = {
            type: 'bubble', size: 'giga',
            header: {
              type: 'box', layout: 'vertical',
              contents: [
                { type: 'text', text: '診断結果', size: 'lg', weight: 'bold', color: '#1e293b' },
                { type: 'text', text: `${friend.display_name || ''}さんの回答`, size: 'xs', color: '#64748b', margin: 'sm' },
              ],
              paddingAll: '20px', backgroundColor: '#f0fdf4',
            },
            body: {
              type: 'box', layout: 'vertical',
              contents: [
                ...answerRows,
                { type: 'separator', margin: 'lg' },
                { type: 'text', text: '他社サービスでは、フォームの回答内容に合わせたリアルタイム返信はできません。LINE Harnessだからこそ可能な体験です。', size: 'xs', color: '#06C755', weight: 'bold', wrap: true, margin: 'lg' },
              ],
              paddingAll: '20px',
            },
          };

          const messages: ReturnType<typeof buildMessage>[] = [];

          const { buildRewardMessage } = await import('../services/reward-message.js');
          const rewardFromTrackedLink = buildRewardMessage(rewardTemplate, friend.display_name);

          if (rewardFromTrackedLink) {
            // Tracked-link reward template overrides everything (per-campaign reward)
            messages.push(rewardFromTrackedLink as ReturnType<typeof buildMessage>);
          } else if (form.on_submit_message_type && form.on_submit_message_content) {
            // Custom form message replaces default diagnostic result
            const { resolveInterpolationExtra } = await import('../services/interpolation-context.js');
            const extra = await resolveInterpolationExtra(db, friend.id, form.on_submit_message_content);
            const expanded = expandVariables(form.on_submit_message_content, friendData, apiOrigin, form.on_submit_message_type, extra);
            // 1:1 push → /t リンクに f=<friendId> を焼き込み (LIFF 識別ホップ回避)
            const { appendFriendToTrackedLinks } = await import('../services/auto-track.js');
            const decorated = await appendFriendToTrackedLinks(db, expanded, apiOrigin, friend.id);
            messages.push(buildMessage(form.on_submit_message_type, decorated));
          } else {
            // Default: send diagnostic result Flex
            messages.push(buildMessage('flex', JSON.stringify(resultFlex)));
          }

          // プロキシが LINE 送信と messages_log 記録を一体で行う。
          await pushViaHarnessProxy(
            new URL(c.req.url).origin,
            accessToken,
            friend.line_user_id,
            messages,
            crypto.randomUUID(),
            (request) => dispatchLineProxyLocally(request, c.env, optionalExecutionCtx(c)),
          );
        })(),
      );

      if (sideEffects.length > 0) {
        const results = await Promise.allSettled(sideEffects);
        for (const r of results) {
          if (r.status === 'rejected') console.error('Form side-effect failed:', r.reason);
        }
      }
    }

    return c.json({ success: true, data: serializeSubmission(submission) }, 201);
  } catch (err) {
    console.error('POST /api/forms/:id/submit error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

async function callFormWebhook(
  form: DbForm,
  submissionData: Record<string, unknown>,
): Promise<{ passed: boolean; data: unknown }> {
  if (!form.on_submit_webhook_url) return { passed: true, data: null };

  try {
    // Replace {field_name} placeholders in URL with submitted values
    let url = form.on_submit_webhook_url;
    for (const [key, value] of Object.entries(submissionData)) {
      url = url.replace(`{${key}}`, encodeURIComponent(String(value ?? '')));
    }

    // Parse headers
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (form.on_submit_webhook_headers) {
      try {
        const parsed = JSON.parse(form.on_submit_webhook_headers) as Record<string, string>;
        Object.assign(headers, parsed);
      } catch { /* ignore invalid headers */ }
    }

    // Determine method: GET if URL has {placeholders} replaced, POST otherwise
    const isGet = form.on_submit_webhook_url.includes('{');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: isGet ? 'GET' : 'POST',
      headers,
      signal: controller.signal,
      ...(isGet ? {} : { body: JSON.stringify(submissionData) }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { passed: false, data: { error: `HTTP ${res.status}` } };
    }

    const data = await res.json() as Record<string, unknown>;

    // Check for eligibility — support both { eligible: bool } and { success: bool, data: { eligible: bool } }
    const eligible = data.eligible ?? (data.data as Record<string, unknown> | undefined)?.eligible ?? data.success;
    return { passed: Boolean(eligible), data };
  } catch (err) {
    console.error('Form webhook error:', err);
    return { passed: false, data: { error: String(err) } };
  }
}

export { forms };
