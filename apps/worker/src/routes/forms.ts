import { Hono, type Context } from 'hono';
import {
  getForms,
  getFormsWithStats,
  getFormById,
  type FormSubmitClaim,
  type FormSubmitClaimScope,
  getFormAccountIds,
  getFormDeleteImpact,
  formBelongsToLineAccount,
  createForm,
  updateForm,
  type UpdateFormInput,
  archiveFormAtRevision,
  deleteFormAtRevision,
  getFormSubmissions,
  getFormSubmissionsPage,
  getFormSubmissionAnalytics,
  getLatestFormSubmission,
  getFormSubmissionById,
  insertFormSubmissionRecord,
  resyncFormSubmitCount,
  createFormSubmitClaim,
  getFormSubmitClaim,
  takeoverFormSubmitClaim,
  readFormSubmitClaimSteps,
  appendFormSubmitClaimStep,
  saveFormSubmitClaimWebhook,
  completeFormSubmitClaim,
  failFormSubmitClaim,
  ensureFormSubmitOutboxEvent,
  getFormSubmitOutbox,
  markFormSubmitOutboxDelivered,
  readFormSubmitOutboxPayload,
  readFormSubmitClaimEffectStats,
  saveFormSubmitClaimEffectStats,
  findUnfinishedFormSubmitClaimByHash,
  updateFormSubmissionDestinationWriteResult,
  getFriendByLineUserIdForAccount,
  getFriendById,
  getLineAccountById,
  jstNow,
  toJstString,
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
  FormDestinationWriteResult,
  FormUsedByAccount,
  Friend as DbFriend,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { resolveLineToken } from '../services/line-token.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { applyMileageRulesForEvent } from '@line-crm/db';
import { createBroadcastRetryKey } from '../services/broadcast-retry-key.js';
import { dispatchAutomationEventWithLogging } from '../services/automation-triggers.js';
import { applyActionScoreEvent } from '../services/action-score-events.js';
import { recordConversionSourceEvent } from '../services/conversion-event-sources.js';
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
/**
 * 下書き保存(partial)が友だちmetadataへ書き込む上限。
 * 短い答えの一時置き場のため十分な大きさ。
 */
const PARTIAL_MERGED_MAX_BYTES = 32 * 1024;
/*
 * ページ分けなしの回答一覧の天井。**この数がただ1つの出どころ。**
 * SQL の `LIMIT` にもこれを渡し、`Warning` でもこれを名乗る。
 *
 * #722 の前はここが 500、DB 側が 200 の直書きで、**名乗りと実際が食い違って
 * いた。**利用先は 201件目から黙って取り落としていて、応答は 200 OK、
 * `Warning` は「500件まで」。取り落としに気づく手がかりが無かった。
 *
 * 200 なのは、この現場の一覧ヘルパが全部 `boundedListLimit` で
 * `MAX_LIST_LIMIT`（200）に抑えられているから。ここだけ 500 にすると、
 * ほかのどの一覧よりも 2.5 倍重い応答を1つだけ作ることになる
 * （そもそも上限を置いた理由が「重い応答」だった）。
 * この数と `MAX_LIST_LIMIT` が離れていないことは
 * `forms-limit-and-opens-guard.test.ts` が見張っている。
 */
const NON_PAGINATED_SUBMISSIONS_MAX = 200;
/**
 * 冪等キーは UUID。回答行の id そのものとして使い、同じキーの再送・同時
 * 送信を 1 行にまとめる(一斉配信の Idempotency-Key と同じ流儀)。
 */
const FORM_IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** 同じキーの再送を受け付ける期間。通信の再送や連打はこの中に収まる。 */
const FORM_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * 処理中の予約を止まったとみなす期間。Webhook の待ち時間(10秒)や副作用の
 * 実行を覆う余裕を持たせ、生きている処理の横取りはしない。
 */
const FORM_SUBMIT_CLAIM_STALE_MS = 60 * 1000;
/** 回答 data の上限。項目数と JSON 全体の大きさの両方を見る。 */
const FORM_SUBMIT_DATA_MAX_FIELDS = 200;
const FORM_SUBMIT_DATA_MAX_BYTES = 100 * 1024;
/** 紐付けリンク id の上限。長すぎる値は受け付けない。 */
const FORM_SUBMIT_TRACKED_LINK_MAX_LENGTH = 128;

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
  opts?: {
    /**
     * 閲覧だけの役割(staff)へ返すときは連携先の秘密を隠す。
     * 有無だけを残し、中身は owner / admin だけが読める。
     */
    redactSecrets?: boolean;
  },
) {
  const redactSecrets = opts?.redactSecrets === true;
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
    onSubmitWebhookUrl: redactSecrets ? null : row.on_submit_webhook_url,
    onSubmitWebhookHeaders: redactSecrets ? null : row.on_submit_webhook_headers,
    hasSubmitWebhook: Boolean(row.on_submit_webhook_url),
    onSubmitWebhookFailMessage: row.on_submit_webhook_fail_message,
    saveToMetadata: Boolean(row.save_to_metadata),
    isActive: Boolean(row.is_active),
    status: row.status,
    archivedAt: row.archived_at,
    revision: row.revision,
    contentRevision: row.content_revision,
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
    destinationWrite: {
      status: row.destination_write_status ?? 'unknown',
      attempted: row.destination_write_attempted ?? null,
      succeeded: row.destination_write_succeeded ?? null,
      failed: row.destination_write_failed ?? null,
    },
    createdAt: row.created_at,
  };
}

/**
 * 回答内容を決まった形の文にする。再送の照合に使い、キーの順番が違っても
 * 同じ回答は同じ文になる。
 */
function canonicalizeIdempotencyInput(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeIdempotencyInput).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeIdempotencyInput(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 回答内容のハッシュ。同じキーの再送が同じ回答かを照合する。 */
async function hashIdempotentSubmission(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 期限切れの予約。再送は受け付けず、新しいキーでの送り直しを求める。 */
function formSubmitClaimExpired(claim: Pick<FormSubmitClaim, 'expires_at'>): boolean {
  if (!claim.expires_at) return false;
  const expiresAt = Date.parse(claim.expires_at);
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

/** 止まったとみなす基準時刻(JST 文字列で比較する)。 */
function formSubmitClaimStaleBefore(): string {
  return toJstString(new Date(Date.now() - FORM_SUBMIT_CLAIM_STALE_MS));
}

/**
 * 再送の応答。保存時と同じ形を返し、連携の成否も再現する。
 * 連携で弾かれた回答の再送は、弾かれたときの結果のまま返す。
 */
function serializeIdempotentReplay(row: DbFormSubmission): Record<string, unknown> {
  const base = serializeSubmission(row) as Record<string, unknown>;
  try {
    const data = JSON.parse(row.data || '{}') as Record<string, unknown>;
    if ('_webhookResult' in data) {
      return { ...base, webhookPassed: false, webhookData: data._webhookResult };
    }
  } catch {
    // 壊れた回答は基本形のまま返す
  }
  return base;
}

/**
 * 処理の途中で予約の所有者を失った合図。横取りした試行と副作用を重ねない
 * よう、その場で止めて送り直しの応答を持ち帰る。
 */
class ClaimOwnershipLost {
  constructor(readonly response: Response) {}
}

function dateFieldsOfForm(form: DbForm): Array<{ key: string; label: string }> {
  const layout = form.layout ? parseLayout(form.layout, form.fields) : null;
  if (layout) {
    return collectInputs(layout)
      .filter((block) => block.type === 'date' && block.name)
      .map((block) => ({ key: block.name, label: block.label || block.name }));
  }
  return parseFormFields(form.fields)
    .filter((field) => field.type === 'date')
    .map((field) => ({
      key: field.name ?? field.id ?? '',
      label: field.label ?? field.name ?? field.id ?? '',
    }))
    .filter((field) => field.key);
}

async function writeLegacyFriendFields(
  db: D1Database,
  form: DbForm,
  submissionData: Record<string, unknown>,
  friendId: string,
): Promise<FormDestinationWriteResult> {
  const result: FormDestinationWriteResult = { attempted: 0, succeeded: 0, failed: 0 };
  const targets = parseFormFields(form.fields).filter((field) => field.friendFieldId);
  if (targets.length === 0) return result;
  const { setFriendFieldValue, getFriendFieldById } = await import('@line-crm/db');
  for (const field of targets) {
    const answer = submissionData[field.name ?? field.id ?? ''];
    if (answer === undefined) continue;
    result.attempted += 1;
    try {
      const target = await getFriendFieldById(db, field.friendFieldId!);
      if (!target || target.ec_is_master === 1) {
        result.failed += 1;
        continue;
      }
      await setFriendFieldValue(db, {
        friendId,
        fieldId: field.friendFieldId!,
        value: answer == null
          ? null
          : Array.isArray(answer)
            ? answer.join(', ')
            : String(answer),
        updatedBy: 'form',
      });
      result.succeeded += 1;
    } catch (error) {
      result.failed += 1;
      console.error('form -> friend_fields failed:', error);
    }
  }
  return result;
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
    const redactSecrets = c.get('staff')?.role === 'staff';
    const data = items.map((row) =>
      serializeForm(row, {
        lastSubmittedAt: row.last_submitted_at,
        usedByAccounts: row.used_by_accounts,
        accountScopeReviewRequired: row.account_scope_review_required,
      }, { redactSecrets }),
    );
    // 一覧画面は `with_list_summary=1` で件数つきの形を要求する。
    // 付けない呼び出しは従来どおり配列のまま返す。
    if (c.req.query('with_list_summary') === '1') {
      return c.json({
        success: true,
        data: { items: data, total: data.length, page: 1, limit: data.length },
      });
    }
    return c.json({ success: true, data });
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
    const data = staff
      ? serializeForm(form, undefined, { redactSecrets: staff.role === 'staff' })
      : serializePublicForm(form);
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
      expectedContentRevision?: unknown;
    }>();

    /*
     * #723: 確認した編集の版を必ず受け取る。
     *
     * 以前はここに版が無く、2人が同時に編集すると後から保存した人の内容で
     * 黙って上書きされていた。保存は成功と返り、先の人の変更は消えた。
     *
     * 見るのは `content_revision`（migration 379）で、`revision` ではない。
     * `revision` は migration 259 のトリガが来訪・回答で増やす「削除影響の
     * 確認版」なので、編集の楽観ロックに使うと誰も編集していないのに 409 に
     * なる。保管・削除は引き続き `revision` を見る。
     *
     * 受付停止（一覧の `stopAccepting`）も同じ口を通るので、版を免除しない。
     * 免除すると、停止したはずのフォームが編集画面の保存で公開中に戻る。
     */
    const expectedContentRevision = typeof body.expectedContentRevision === 'number'
      ? body.expectedContentRevision
      : Number.NaN;
    if (!Number.isInteger(expectedContentRevision) || expectedContentRevision < 1) {
      return c.json({ success: false, error: '確認した版が必要です' }, 400);
    }

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

    const updated = await updateForm(c.env.DB, id, updates as UpdateFormInput, expectedContentRevision);

    if (updated.kind === 'not_found') {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if (updated.kind === 'conflict') {
      // 画面は入力を捨てず、この時刻を添えて「ほかの人が先に保存しました」と出す。
      // `ApiError.data` は 409 のときだけ画面へ渡る作りなので、ここに載せる。
      return c.json({
        success: false,
        error: 'form_content_changed',
        message: 'ほかの人が先に保存しました。最新の内容を読み込んでから、もう一度お試しください。',
        data: {
          contentRevision: updated.form.content_revision,
          updatedAt: updated.form.updated_at,
        },
      }, 409);
    }

    return c.json({ success: true, data: serializeForm(updated.form) });
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
      // 大きいフォームで重い応答になるため上限を置く。page/limit 付きへ移行すること。
      /*
       * **切るのは `getFormSubmissions` の SQL ひとつだけ。**ここで重ねて
       * `slice` すると、DB 側の天井を上げても口が黙って切り直してしまい、
       * 「名乗りと実際がずれているのに気づけない」という #722 の形がそのまま
       * 残る（実際、逆変異で確かめた: DB 側を 500 にしても slice があると
       * 試験が緑のままだった）。数も切る場所も1か所にする。
       */
      const submissions = await getFormSubmissions(c.env.DB, id, NON_PAGINATED_SUBMISSIONS_MAX);
      // Header 値は ASCII のみ。日本語の案内は PR と票に残す。
      // 数は直書きしない。名乗りと実際がずれると、取り落としに気づけない。
      c.header(
        'Warning',
        `299 - "non-paginated submissions are limited to ${NON_PAGINATED_SUBMISSIONS_MAX} rows; use page/limit"`,
      );
      return c.json({ success: true, data: submissions.map(serializeSubmission) });
    }
    const page = listPage(c.req.query('page'));
    const limit = listLimit(c.req.query('limit'), 20);
    const [submissions, summary] = await Promise.all([
      getFormSubmissionsPage(c.env.DB, id, { page, limit, lineAccountId: c.req.query('account_id')! }),
      getFormSubmissionAnalytics(
        c.env.DB,
        id,
        c.req.query('account_id')!,
        dateFieldsOfForm(form),
      ),
    ]);
    return c.json({
      success: true,
      data: {
        items: submissions.items.map(serializeSubmission),
        total: submissions.total,
        page: submissions.page,
        limit: submissions.limit,
        summary,
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
    /*
     * 受け付けていないフォームの「開いた記録」を増やさない。**塞ぐのは2つ。**
     *
     *   保管した（status='archived'） … `getFormById` が見つけない → 404
     *   受付を止めた（is_active=0）   … 下で弾く → 記録せず 200
     *
     * #722 の前は保管の側しか塞いでおらず、注記も保管のことしか書いて
     * いなかった。読むと全部塞がったように見えるのに、**受付を止めた
     * フォームは開かれるたびに `form_opens` が増え続けていた。**削除影響の
     * 画面に出る「開かれた回数」が水増しされ、止めたはずのフォームが
     * 使われ続けているように見えた。
     *
     * 止めた側を 404 にしないのは、この口が計測用で、呼び出し元（LIFF）の
     * 表示を邪魔しないため。**すぐ下の「関係のない公式アカウント」も同じ形**
     * ——記録せずに 200 を返す。
     */
    const openedForm = await getFormById(c.env.DB, formId);
    if (!openedForm) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if (!openedForm.is_active) {
      return c.json({ success: true });
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

    const form = await getFormById(c.env.DB, c.req.param('id'));
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    /*
     * 受付を止めたフォームへ下書きを書かない（#722）。ここは友だちの
     * `friends.metadata` を直に書き換えるので、止めたあとも書けると
     * **受け付けていないはずの答えが業務データへ入り続ける。**
     * 断り方は `/submit`（:1024）・`/files`（:891）と同じ 400 に揃える。
     */
    if (!form.is_active) {
      return c.json({ success: false, error: 'This form is no longer accepting responses' }, 400);
    }
    // 回答定義に無い鍵は受け付けない。業務で使う鍵の上書きを防ぐ。
    const allowedNames = new Set(
      collectInputs(parseLayout(form.layout, form.fields)).map((block) => block.name),
    );
    const incoming = body.data && typeof body.data === 'object' ? body.data : {};
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (allowedNames.has(key)) filtered[key] = value;
    }

    // Save survey data to friend metadata (merge with existing).
    // 壊れた既存値は空として扱う。ここで例外を投げると500になる。
    let existingMeta: Record<string, unknown> = {};
    try {
      const parsed: unknown = friend.metadata ? JSON.parse(friend.metadata) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existingMeta = parsed as Record<string, unknown>;
      }
    } catch {
      existingMeta = {};
    }
    const merged = { ...existingMeta, ...filtered };
    const mergedJson = JSON.stringify(merged);
    if (new TextEncoder().encode(mergedJson).byteLength > PARTIAL_MERGED_MAX_BYTES) {
      return c.json({ success: false, error: '送信内容が大きすぎます' }, 413);
    }
    await c.env.DB.prepare(
      'UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?',
    ).bind(mergedJson, jstNow(), friend.id).run();

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
//
// 再送・連打の二重受理を防ぐため、Idempotency-Key ヘッダ(UUID)を受け付ける。
// キーは回答行の id そのものになり、同じキーの再送は保存済みの行を返す。
// 同じキーで内容が違う使い回しは 409 で断る。キーが無い送信は従来どおり。
forms.post('/api/forms/:id/submit', async (c) => {
  try {
    const formId = c.req.param('id');
    // 送信には Idempotency-Key(UUID)が必須。キーなしの連打・再送は
    // 二重回答になるため受け付けない(イベント予約と同じ流儀)。
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim() || null;
    if (!idempotencyKey) {
      return c.json({ success: false, error: 'idempotency_key_required' }, 400);
    }
    if (!FORM_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return c.json({ success: false, error: 'Idempotency-Key must be a UUID' }, 400);
    }
    const form = await getFormById(c.env.DB, formId);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if (!form.is_active) {
      return c.json({ success: false, error: 'This form is no longer accepting responses' }, 400);
    }

    let body: { data?: unknown; trackedLinkId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'リクエストの形式が正しくありません' }, 400);
    }
    // data と trackedLinkId は実行時に形と大きさを見る。形の違う値は
    // 後の処理で落ちる前に 400 で断る。
    if (body.data !== undefined
      && (body.data === null || typeof body.data !== 'object' || Array.isArray(body.data))) {
      return c.json({ success: false, error: '回答の形式が正しくありません' }, 400);
    }
    const submissionData = (body.data ?? {}) as Record<string, unknown>;
    if (Object.keys(submissionData).length > FORM_SUBMIT_DATA_MAX_FIELDS
      || JSON.stringify(submissionData).length > FORM_SUBMIT_DATA_MAX_BYTES) {
      return c.json({ success: false, error: '回答が大きすぎます' }, 400);
    }
    if (body.trackedLinkId !== undefined
      && (typeof body.trackedLinkId !== 'string'
        || body.trackedLinkId.length > FORM_SUBMIT_TRACKED_LINK_MAX_LENGTH)) {
      return c.json({ success: false, error: 'リンクの指定が正しくありません' }, 400);
    }
    const trackedLinkId: string | undefined = typeof body.trackedLinkId === 'string'
      ? body.trackedLinkId
      : undefined;

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

    // キーあり送信の照合材料。読み取りだけに使い、予約の書き込みは判定の後。
    let peekScope: FormSubmitClaimScope | null = null;
    let peekHash: string | null = null;
    if (idempotencyKey) {
      const hashSource: Record<string, unknown> = { ...submissionData };
      delete hashSource._webhookVerified;
      delete hashSource._skipWebhook;
      peekHash = await hashIdempotentSubmission(canonicalizeIdempotencyInput({
        data: hashSource,
        trackedLinkId: trackedLinkId ?? null,
      }));
      const lineAccount = await getLineAccountById(c.env.DB, identity.lineAccountId);
      peekScope = {
        tenantId: lineAccount?.tenant_id ?? '',
        lineAccountId: identity.lineAccountId,
        formId,
        friendId,
        key: idempotencyKey,
      };
      // 完了済みの再送は判定より先に返す(回答期限後も最初の結果のまま)。
      const peeked = await getFormSubmitClaim(c.env.DB, peekScope);
      if (peeked
        && peeked.status === 'completed'
        && peeked.request_hash === peekHash
        && !formSubmitClaimExpired(peeked)) {
        const saved = peeked.submission_id
          ? await getFormSubmissionById(c.env.DB, peeked.submission_id)
          : null;
        if (saved) {
          c.header('Idempotency-Replayed', 'true');
          return c.json({ success: true, data: serializeIdempotentReplay(saved) }, 200);
        }
      }
    }

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

    // 冪等予約(キーありのみ)。外部副作用(Webhook・LINE通知)より前に予約行を
    // 原子的に確保し、同時送信の片方だけが処理を進める。scope は
    // (テナント・LINEアカウント・フォーム・友だち・キー)。
    type ClaimContext = {
      scope: FormSubmitClaimScope;
      owner: string;
      version: number;
      generation: number;
      submissionId: string;
      steps: Set<string>;
      resumed: boolean;
    };
    // 生きている処理と重なったときの送り直し案内。
    // error は LIFF が判別する符号、retryable は送り直してよい合図。
    const claimBusyResponse = () => c.json(
      {
        success: false,
        error: 'idempotent_in_progress',
        retryable: true,
      },
      429,
    );
    let claimCtx: ClaimContext | null = null;
    // LINE 送信の再送キー。予約時に確保した回答idと工程から決まる固定の
    // UUID にし、再開時の送り直しを LINE 側の重複除去にかけさせる。
    // 都度 randomUUID にすると停止と再実行の間で二重送信になる。
    // UUID 形なのはプロバイダの再送キー要件に合わせるため。
    // 回答の保存より前(失敗通知)でも使える。
    let retryAnswerId: string | null = null;
    const lineRetryKey = (step: string) =>
      createBroadcastRetryKey('form-submit', retryAnswerId ?? submission.id, step);
    if (idempotencyKey && peekScope && peekHash) {
      const scope = peekScope;
      const requestHash = peekHash;
      const owner = crypto.randomUUID();
      const submissionId = crypto.randomUUID();
      // 画面を開き直してキーが変わった再送でも、同じ内容の未完の予約が
      // あれば新しい回答を作らず、元のキーでの再開へ誘導する(二重回答に
      // しない。完了済み・期限切れは新しい送信として扱う)。
      const unfinished = await findUnfinishedFormSubmitClaimByHash(c.env.DB, scope, requestHash);
      if (unfinished && unfinished.idempotency_key !== idempotencyKey
        && !formSubmitClaimExpired(unfinished)) {
        return c.json(
          {
            success: false,
            error: '同じ内容の送信が処理中のため、元のキーで送り直してください',
            code: 'idempotency_recovery_pending',
            retryable: true,
            idempotencyKey: unfinished.idempotency_key,
          },
          409,
        );
      }
      const acquired = await createFormSubmitClaim(c.env.DB, {
        ...scope,
        requestHash,
        submissionId,
        owner,
        expiresAt: new Date(Date.now() + FORM_IDEMPOTENCY_TTL_MS).toISOString(),
      });
      if (acquired.claimed) {
        claimCtx = { scope, owner, version: 1, generation: 1, submissionId, steps: new Set(), resumed: false };
        retryAnswerId = submissionId;
      } else {
        const existing = acquired.claim;
        if (existing.request_hash !== requestHash) {
          return c.json(
            {
              success: false,
              error: 'Idempotency-Key was already used with a different request',
              code: 'idempotency_content_mismatch',
              retryable: false,
            },
            409,
          );
        }
        if (existing.status === 'completed') {
          if (formSubmitClaimExpired(existing)) {
            return c.json(
              {
                success: false,
                error: 'Idempotency-Key の有効期限が切れました。新しいキーで送り直してください',
                code: 'idempotency_expired',
                retryable: false,
              },
              409,
            );
          }
          const saved = existing.submission_id
            ? await getFormSubmissionById(c.env.DB, existing.submission_id)
            : null;
          if (!saved) {
            console.error('form submit claim is completed without an answer row');
            return c.json({ success: false, error: 'Internal server error' }, 500);
          }
          c.header('Idempotency-Replayed', 'true');
          return c.json({ success: true, data: serializeIdempotentReplay(saved) }, 200);
        }
        // failed は即時、in_progress は止まっているものだけ横取りして再開する。
        // 生きている処理とは重ねず、送り直しを求める。横取りは読み取った
        // 所有者と版の CAS で行い、版と借りの世代を進める。古い版の試行の
        // 書き込みは工程側の版ガードで捨てる。
        const staleBefore = existing.status === 'failed' || formSubmitClaimExpired(existing)
          ? toJstString(new Date())
          : formSubmitClaimStaleBefore();
        const takeover = await takeoverFormSubmitClaim(
          c.env.DB,
          scope,
          owner,
          staleBefore,
          { owner: existing.owner, version: existing.version },
        );
        if (!takeover.taken) {
          return claimBusyResponse();
        }
        const taken = (await getFormSubmitClaim(c.env.DB, scope))!;
        claimCtx = {
          scope,
          owner,
          version: taken.version,
          generation: takeover.generation,
          submissionId: taken.submission_id ?? submissionId,
          steps: new Set(readFormSubmitClaimSteps(taken)),
          resumed: true,
        };
        retryAnswerId = claimCtx.submissionId;
      }
    }

    // 工程の記録。キーなし送信では何もしない。
    const claimDone = (step: string): boolean => claimCtx?.steps.has(step) ?? false;
    const claimCheckpoint = async (step: string): Promise<Response | null> => {
      if (!claimCtx) return null;
      const ok = await appendFormSubmitClaimStep(c.env.DB, claimCtx.scope, claimCtx.owner, step, claimCtx.version);
      if (ok) {
        claimCtx.steps.add(step);
        return null;
      }
      return claimBusyResponse();
    };
    // 予約の締め。未完の工程があれば failed に残して一覧を返し、同じキー
    // での再送に補完を託す。全部終わっていれば completed にする。
    const settleClaim = async (required: string[]): Promise<string[]> => {
      if (!claimCtx) return [];
      const missing = required.filter((step) => !claimCtx!.steps.has(step));
      try {
        if (missing.length === 0) {
          await completeFormSubmitClaim(c.env.DB, claimCtx.scope, claimCtx.owner, claimCtx.version);
        } else {
          await failFormSubmitClaim(c.env.DB, claimCtx.scope, claimCtx.owner, claimCtx.version);
        }
      } catch (error) {
        console.error('form submit claim finalize failed:', error);
      }
      return missing;
    };
    // 再開で終わらせた処理は 200 で返す(初回だけ 201)。
    const settleResponse = (data: unknown, status: 200 | 201) => {
      if (claimCtx?.resumed) {
        c.header('Idempotency-Replayed', 'true');
        return c.json({ success: true, data }, 200);
      }
      return c.json({ success: true, data }, status);
    };
    // 未完の工程が残ったときの応答。回答は保存済みでも 201 は返さず、
    // 202 で未完の一覧と送り直しの合図を返す。201 で返すと利用者側の
    // 再試行経路が消えて、欠落が固定される。
    const incompleteResponse = (data: Record<string, unknown>, pending: string[]) => {
      if (claimCtx?.resumed) c.header('Idempotency-Replayed', 'true');
      return c.json(
        {
          success: true,
          data: { ...data, complete: false, pendingEffects: pending },
          retryable: true,
        },
        202,
      );
    };

    // 回答の保存。キーありでは予約時に確保した id で保存・読み返しし、
    // 二重保存しない。保存に失敗したら予約を failed に残して同じキーでの
    // 再開に託し、回答失敗として 500 を返す。
    const ensureAnswer = async (data: string): Promise<DbFormSubmission> => {
      const ctx = claimCtx!;
      if (!claimDone('answer')) {
        const linked = await getFormSubmissionById(c.env.DB, ctx.submissionId);
        if (!linked) {
          try {
            await insertFormSubmissionRecord(c.env.DB, {
              id: ctx.submissionId,
              formId,
              friendId,
              data,
            });
          } catch (error) {
            await failFormSubmitClaim(c.env.DB, ctx.scope, ctx.owner, ctx.version).catch(() => {});
            throw error;
          }
        }
        const lost = await claimCheckpoint('answer');
        if (lost) throw new ClaimOwnershipLost(lost);
      }
      return (await getFormSubmissionById(c.env.DB, ctx.submissionId))!;
    };
    // 受付数の再計算は何度実行しても同じ値になる。再開時に重ねても狂わない。
    const ensureSubmitCount = async (): Promise<void> => {
      if (!claimCtx || claimDone('submit_count')) return;
      try {
        await resyncFormSubmitCount(c.env.DB, formId);
      } catch (error) {
        await failFormSubmitClaim(c.env.DB, claimCtx.scope, claimCtx.owner, claimCtx.version).catch(() => {});
        throw error;
      }
      const lost = await claimCheckpoint('submit_count');
      if (lost) throw new ClaimOwnershipLost(lost);
    };

    let submission: DbFormSubmission;
    let webhookData: Record<string, unknown> | null = null;
    // 配分結果の記録。キーありの再開時に記録済みなら上書きせず、集計値を残す。
    const updateDestinationWriteResult = async (result: FormDestinationWriteResult): Promise<void> => {
      if (claimCtx && claimDone('destination_status')) {
        const current = await getFormSubmissionById(c.env.DB, submission.id);
        if (current && current.destination_write_status !== 'pending') return;
      }
      try {
        const status = await updateFormSubmissionDestinationWriteResult(c.env.DB, submission.id, result);
        submission.destination_write_status = status;
        submission.destination_write_attempted = result.attempted;
        submission.destination_write_succeeded = result.succeeded;
        submission.destination_write_failed = result.failed;
      } catch (error) {
        // 回答自体は保存済み。記録失敗を回答失敗へ見せず、再開時に残す。
        console.error('form destination write result failed:', error);
        return;
      }
      if (claimCtx) {
        const lost = await claimCheckpoint('destination_status');
        if (lost) throw new ClaimOwnershipLost(lost);
      }
    };
    try {
      if (form.on_submit_webhook_url) {
        let webhookPassed: boolean;
        let webhookOutcome: unknown;
        // Webhook 配達の安定 event id。予約の scope とキーから決まる固定
        // UUID で、呼び直しも同じ値を X-Form-Event-Id で送る。受け側は
        // この値で重複を除ける。
        const webhookEventId = idempotencyKey && peekScope
          ? await createBroadcastRetryKey(
            'form-submit',
            'webhook',
            peekScope.tenantId,
            peekScope.lineAccountId,
            formId,
            peekScope.friendId,
            idempotencyKey,
          )
          : null;
        const keepWebhookOutcome = async (passed: boolean, data: unknown): Promise<void> => {
          if (!claimCtx) return;
          const kept = await saveFormSubmitClaimWebhook(
            c.env.DB,
            claimCtx.scope,
            claimCtx.owner,
            { passed, data },
            claimCtx.version,
          );
          if (kept) claimCtx.steps.add('webhook');
          else throw new ClaimOwnershipLost(claimBusyResponse());
        };
        if (claimDone('webhook')) {
          // 再開時は呼び直さず、残した結果を使う。
          let savedOutcome: { passed: boolean; data: unknown } | null = null;
          try {
            const saved = await getFormSubmitClaim(c.env.DB, claimCtx!.scope);
            savedOutcome = saved?.webhook
              ? JSON.parse(saved.webhook) as { passed: boolean; data: unknown }
              : null;
          } catch {
            savedOutcome = null;
          }
          if ((!savedOutcome || typeof savedOutcome.passed !== 'boolean') && claimCtx) {
            // 結果が壊れているときは outbox の配達結果を使う。配達済みで
            // 結果があれば呼び直さない。なければ同じ event id で呼び直す。
            const outbox = await getFormSubmitOutbox(c.env.DB, claimCtx.scope, 'webhook');
            const delivered = readFormSubmitOutboxPayload(outbox?.payload ?? null);
            if (delivered) {
              savedOutcome = delivered;
            } else if (webhookEventId) {
              const called = await callFormWebhook(form, submissionData, webhookEventId);
              await markFormSubmitOutboxDelivered(
                c.env.DB,
                claimCtx.scope,
                'webhook',
                webhookEventId,
                { passed: called.passed, data: called.data },
              );
              savedOutcome = { passed: called.passed, data: called.data };
            }
          }
          if (!savedOutcome || typeof savedOutcome.passed !== 'boolean') {
            // 結果が壊れているときだけ呼び直す。
            const called = await callFormWebhook(form, submissionData, webhookEventId);
            savedOutcome = { passed: called.passed, data: called.data };
          }
          webhookPassed = savedOutcome.passed;
          webhookOutcome = savedOutcome.data;
        } else {
          let called: { passed: boolean; data: unknown };
          if (claimCtx && webhookEventId) {
            // 呼ぶ前に outbox の意図行を作る。配達後に結果ごと残すので、
            // その間の停止は同じ event id の呼び直しになり、二重実行に
            // ならない。配達済みの結果があれば呼ばずに使う。
            const outbox = await ensureFormSubmitOutboxEvent(
              c.env.DB,
              claimCtx.scope,
              'webhook',
              webhookEventId,
            );
            const delivered = readFormSubmitOutboxPayload(outbox.payload);
            if (outbox.status === 'delivered' && delivered) {
              called = delivered;
            } else {
              const fresh = await callFormWebhook(form, submissionData, webhookEventId);
              await markFormSubmitOutboxDelivered(
                c.env.DB,
                claimCtx.scope,
                'webhook',
                webhookEventId,
                { passed: fresh.passed, data: fresh.data },
              );
              called = { passed: fresh.passed, data: fresh.data };
            }
          } else {
            called = await callFormWebhook(form, submissionData, webhookEventId);
          }
          webhookPassed = called.passed;
          webhookOutcome = called.data;
          await keepWebhookOutcome(webhookPassed, webhookOutcome);
        }
        webhookData = webhookOutcome as Record<string, unknown> | null;
        if (!webhookPassed) {
          // Webhook rejected — send fail message and stop
          const needsFailMessage = Boolean(form.on_submit_webhook_fail_message)
            && Boolean(friend.line_user_id);
          if (needsFailMessage && !claimDone('fail_message')) {
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
                friend.line_user_id!,
                [{ type: 'text', text: form.on_submit_webhook_fail_message! }],
                await lineRetryKey('fail-message'),
                (request) => dispatchLineProxyLocally(request, c.env, optionalExecutionCtx(c)),
              );
              const lost = await claimCheckpoint('fail_message');
              if (lost) throw new ClaimOwnershipLost(lost);
            } catch (error) {
              if (error instanceof ClaimOwnershipLost) throw error;
              // 届かなくても回答の保存へ進む。再開時に送り直す。
              console.error('Failed to send webhook fail message:', error);
            }
          }
          // Still save the submission for records
          submission = await ensureAnswer(JSON.stringify({ ...submissionData, _webhookResult: webhookOutcome }));
          await ensureSubmitCount();
          await updateDestinationWriteResult({ attempted: 0, succeeded: 0, failed: 0 });
          const pendingWebhook = await settleClaim([
            'webhook',
            ...(needsFailMessage ? ['fail_message'] : []),
            'answer',
            'submit_count',
            'destination_status',
          ]);
          const rejectedData = {
            ...serializeSubmission(submission),
            webhookPassed: false,
            webhookData: webhookOutcome,
          };
          if (pendingWebhook.length > 0) return incompleteResponse(rejectedData, pendingWebhook);
          return settleResponse(rejectedData, 201);
        }
      }

      // Save submission against the authenticated caller only.
      submission = await ensureAnswer(JSON.stringify(submissionData));
      await ensureSubmitCount();

    if (!claimDone('mileage')) {
      // 付与の呼び出しは失敗を握らない。DB が落ちていれば投げて、
      // 工程未完のまま回答は返し、同じキーでの再送で付け直す。
      // (台帳は program+key の一意性で二重付与しない)
      let awarded = false;
      try {
        await applyMileageRulesForEvent(c.env.DB, {
          eventType: 'form_submitted',
          source: 'form',
          sourceEventId: submission.id,
          friendId,
          subjectKey: formId,
          metadata: { formId, formName: form.name },
          occurredAt: submission.created_at,
        });
        awarded = true;
      } catch (error) {
        console.error('form_submitted mileage failed:', error);
      }
      if (awarded && claimCtx) {
        const lost = await claimCheckpoint('mileage');
        if (lost) throw new ClaimOwnershipLost(lost);
      }
    }

    const executionCtx = optionalExecutionCtx(c);

    // 回答の保存を成果計測へ接続する(#648)。「フォームが送信された」を起点に
    // 選んだ地点は、ここを通らないと 0 件のままになる。
    //
    // Webhook に弾かれた回答はここまで来ない(上で早期に返す)。冪等キーには
    // 回答IDを使う。同じ Idempotency-Key の再送は同じ回答IDへ落ち着くので、
    // 二度数えない。失敗しても回答の応答は返す(記録だけ残す)。
    //
    // 応答を返す手前でDBを2回引くと、並行の2要求が予約の窓の中で長く重なる。
    // 隣の行動スコア・自動化と同じく、実行文脈があれば応答の後ろへ回す
    // (無い呼ばれ方でも数えられるよう、その場合だけその場で待つ)。
    const recordFormConversion = () => recordConversionSourceEvent(c.env.DB, {
      sourceType: 'form_submitted',
      lineAccountId: identity.lineAccountId,
      friendId,
      sourceEventId: submission.id,
      metadata: { formId, submissionId: submission.id },
    }).catch((error) => {
      console.error('form conversion record failed:', error);
      return null;
    });
    if (executionCtx) executionCtx.waitUntil(recordFormConversion());
    else await recordFormConversion();

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
            requestedTrackedLinkId: trackedLinkId ?? null,
          },
          { getFriendById, getTrackedLinkById, getMessageTemplateById },
        );
      }

      // 副作用は工程つきで実行する。キーありの再開時は終わった工程を飛ばし、
      // 未完の工程だけを補完する。キーなし送信は従来どおりすべて実行する。
      const effectRuns: Array<{ step: string; run: () => Promise<unknown> }> = [];
      let destinationWriteResult: FormDestinationWriteResult = {
        attempted: 0,
        succeeded: 0,
        failed: 0,
      };

      // Save response data to friend's metadata
      if (form.save_to_metadata) {
        effectRuns.push({
          step: 'metadata',
          run: async () => {
            const friend = await getFriendById(db, friendId!);
            if (!friend) return;
            const existing = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
            const merged = { ...existing, ...submissionData };
            await db
              .prepare(`UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?`)
              .bind(JSON.stringify(merged), now, friendId)
              .run();
          },
        });
      }

      // layout を持つフォームは、こちらで回答を配る。
      //
      // 登録先（情報欄・本名・システム表示名・個別メモ）、選択肢ごとの
      // タグ／情報欄／動作、日付から動かすリマインダ、回答後の動作までを
      // まとめて実行する。失敗しても送信は成功のまま（保存は済んでいる）。
      if (layout) {
        // layout の効果ごとの集計。再開時は残した集計に足して合計するので、
        // 実行した分だけを数えても重ならない。
        let layoutStats: Record<string, { attempted: number; succeeded: number; failed: number }> = {};
        if (claimCtx) {
          const claimRow = await getFormSubmitClaim(c.env.DB, claimCtx.scope);
          if (claimRow) layoutStats = readFormSubmitClaimEffectStats(claimRow);
        }
        effectRuns.push({
          step: 'layout_effects',
          run: () => applyFormLayoutEffects({
            db,
            layout,
            friendId: friendId!,
            answers: submissionData,
            idempotencyPrefix: `form-submit:${submission.id}`,
            push: {
              defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
              workerUrl: c.env.WORKER_URL,
            },
            // 終わった効果は飛ばし、終わった効果だけを記録する。再開時は
            // 未完の効果だけを補完する(粗い完了扱いで欠落を固定しない)。
            skipEffect: (effectId) => claimDone(`layout:${effectId}`),
            onEffectComplete: async (effectId, delta) => {
              if (!claimCtx) return;
              const prev = layoutStats[effectId] ?? { attempted: 0, succeeded: 0, failed: 0 };
              const merged = {
                attempted: prev.attempted + delta.attempted,
                succeeded: prev.succeeded + delta.succeeded,
                failed: prev.failed + delta.failed,
              };
              layoutStats[effectId] = merged;
              const keptStats = await saveFormSubmitClaimEffectStats(
                c.env.DB,
                claimCtx.scope,
                claimCtx.owner,
                claimCtx.version,
                `layout:${effectId}`,
                merged,
              );
              if (!keptStats) throw new ClaimOwnershipLost(claimBusyResponse());
              const lost = await claimCheckpoint(`layout:${effectId}`);
              if (lost) throw new ClaimOwnershipLost(lost);
            },
            pushText: async (text: string, stableSuffix: string) => {
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
                await lineRetryKey(`layout:${stableSuffix}`),
                (request) => dispatchLineProxyLocally(request, c.env, optionalExecutionCtx(c)),
              );
            },
          }).then((result) => {
            // 効果ごとの集計の合計を配分結果にする。再開時は残した集計を
            // 含むので、合計が正しくなる。
            const totals = { attempted: 0, succeeded: 0, failed: 0 };
            for (const stats of Object.values(layoutStats)) {
              totals.attempted += stats.attempted;
              totals.succeeded += stats.succeeded;
              totals.failed += stats.failed;
            }
            destinationWriteResult = totals;
            // 欠落した工程があれば完了にせず、再送で補完する。
            if (result.failedEffects.length > 0) {
              throw new Error(`form layout effects partial failure: ${result.failedEffects.join(',')}`);
            }
          }),
        });
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
      if (!layout) {
        effectRuns.push({
          step: 'legacy_fields',
          run: () => writeLegacyFriendFields(db, form, submissionData, friendId!).then((result) => {
            destinationWriteResult = result;
          }),
        });
      }

      // Add tag — guarded attach so a tag_added-triggered scenario fires on
      // first-time submit (and never re-fires on duplicate submits).
      if (form.on_submit_tag_id) {
        effectRuns.push({
          step: 'tag',
          run: () => attachTagAndFireSideEffects(db, friendId, form.on_submit_tag_id!, {
            defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
            workerUrl: c.env.WORKER_URL,
          }),
        });
      }

      // Enroll in scenario
      if (form.on_submit_scenario_id) {
        effectRuns.push({
          step: 'scenario',
          run: () => enrollFriendInScenario(db, friendId, form.on_submit_scenario_id!),
        });
      }

      // If webhook returned a join_url (e.g. Meet Harness), send a Flex button to the user
      if (webhookData?.join_url) {
        effectRuns.push({
          step: 'meet_link',
          run: async () => {
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
              await lineRetryKey('meet-link'),
              (request) => dispatchLineProxyLocally(request, c.env, optionalExecutionCtx(c)),
            );
          },
        });
      }

      // Send confirmation message with submitted data back to user
      effectRuns.push({
        step: 'reply',
        run: async () => {
          // 運用ログに内部ID（friendId）は残さない。開始の事実だけ出す。
          console.log('Form reply: starting');
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
            await lineRetryKey('reply'),
            (request) => dispatchLineProxyLocally(request, c.env, optionalExecutionCtx(c)),
          );
        },
      });

    // 1件ずつ記録しながら進め、未完だけを残す。再開時は終わった工程を飛ばす。
    // layout_effects だけは粗い完了で飛ばさず、内側の効果ごとの記録で
    // 補完する(粗い完了扱いでは部分失敗が再開できない)。
    for (const effect of effectRuns) {
      if (effect.step !== 'layout_effects' && claimDone(effect.step)) continue;
      try {
        await effect.run();
      } catch (error) {
        if (error instanceof ClaimOwnershipLost) throw error;
        console.error('Form side-effect failed:', error);
        continue;
      }
      const lost = await claimCheckpoint(effect.step);
      if (lost) throw new ClaimOwnershipLost(lost);
    }
    await updateDestinationWriteResult(destinationWriteResult);
    const pending = await settleClaim([
      ...(form.on_submit_webhook_url ? ['webhook'] : []),
      'answer',
      'submit_count',
      'mileage',
      ...effectRuns.map((effect) => effect.step),
      'destination_status',
    ]);
    if (pending.length > 0) {
      return incompleteResponse(serializeSubmission(submission), pending);
    }
    return settleResponse(serializeSubmission(submission), 201);
    }
  } catch (err) {
    if (err instanceof ClaimOwnershipLost) return err.response;
    if (claimCtx) {
      await failFormSubmitClaim(c.env.DB, claimCtx.scope, claimCtx.owner, claimCtx.version).catch(() => {});
    }
    throw err;
  }
  } catch (err) {
    console.error('POST /api/forms/:id/submit error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

async function callFormWebhook(
  form: DbForm,
  submissionData: Record<string, unknown>,
  eventId: string | null,
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
    // 安定 event id。同じ送信の呼び直しは同じ値になるので、受け側は
    // この値で重複を除ける(durable outbox の片割れ)。
    if (eventId) headers['X-Form-Event-Id'] = eventId;
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
