import { publicFormWebhookData } from '../features/forms/form-webhook/index.js';
import { parseFormFields } from './form-field-definition.js';
import { resolveCustomerFormTheme } from '@line-crm/shared';
import type { FormSubmissionPostActions } from '@line-crm/shared';
import { collectInputs, formatAddressValue, parseLayout, type FormLayout } from '@line-crm/shared';
import { formThemeContrastError, type FormListFilter, type FormListSort } from '@line-crm/shared';

import { type Context } from 'hono';
import { FORM_SUBMIT_CLAIM_STALE_MS, type FormSubmitClaim, getFormAccountIds, getFormDeleteImpact, formBelongsToLineAccount, readFormSubmitClaimSteps, getFormSubmitClaimsBySubmissionIds, getFormVersionContentsByIds, getValidFormTestToken, getLineAccountById, jstNow, toJstString, listLineAccountsWithTenantStatus } from '@line-crm/db';
import type { Form as DbForm, FormSubmission as DbFormSubmission, FormUsedByAccount, FormWithStats as DbFormWithStats, Friend as DbFriend } from '@line-crm/db';




import type { Env } from '../worker-env.js';
import { resolveLineToken } from '../services/line-token.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { resolveRequestBoundaries } from '../services/request-boundary.js';
import { layoutEffectStepIds } from '../features/forms/form-layout-effects/index.js';





export async function stoppedPublicFormResponse(c: Context<Env>, formId: string): Promise<Response | null> {
  const accountIds = await getFormAccountIds(c.env.DB, formId);
  if (accountIds.length === 0) return null;
  const statuses = new Map(
    (await listLineAccountsWithTenantStatus(c.env.DB)).map((account) => [account.id, account.tenant_status]),
  );
  return accountIds.some((accountId) => statuses.get(accountId) === 'active')
    ? null
    : c.json({ success: false, code: 'TENANT_SUSPENDED', error: '現在ご利用いただけません' }, 503);
}

export /**
 * P（回答フォームの公開前の試し）：試し合言葉の共通処理。
 *
 * 公開前の下書きを、お客さま画面で試すための合言葉。生の値は保存せず、
 * SHA-256 の16進だけを台帳に残す。試しで開く・答えるたびに期限を見る。
 * 合言葉が違う・期限切れのときは失敗側に閉じる（本物としては扱わない）。
 */
const FORM_TEST_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const FORM_TEST_TOKEN_MAX_ACTIVE = 5;

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export /** 要求に付いた試し合言葉を読む。ヘッダかクエリのどちらか。 */
function readFormTestToken(c: Context<Env>): string | null {
  const header = c.req.header('X-Form-Test-Token')?.trim();
  if (header) return header;
  const query = c.req.query('test_token')?.trim();
  return query ? query : null;
}

export async function verifyFormTestToken(
  db: D1Database,
  formId: string,
  presented: string,
): Promise<boolean> {
  if (!presented) return false;
  const hash = await sha256Hex(presented);
  return (await getValidFormTestToken(db, formId, hash, jstNow())) !== null;
}

export /** 回答に添付できる画像。heic は iPhone の既定の形式なので入れておく。 */
const FORM_UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export const FORM_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const FORM_ARCHIVE_BODY_MAX_BYTES = 16 * 1024;

export /**
 * 下書き保存(partial)が友だちmetadataへ書き込む上限。
 * 短い答えの一時置き場のため十分な大きさ。
 */
const PARTIAL_MERGED_MAX_BYTES = 32 * 1024;

export /*
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

export /**
 * 冪等キーは UUID。回答行の id そのものとして使い、同じキーの再送・同時
 * 送信を 1 行にまとめる(一斉配信の Idempotency-Key と同じ流儀)。
 */
const FORM_IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export /** 同じキーの再送を受け付ける期間。通信の再送や連打はこの中に収まる。 */
const FORM_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export // 処理中の予約を止まったとみなす期間(FORM_SUBMIT_CLAIM_STALE_MS)は
// @line-crm/db 側の定数を使う。一覧の未完の札・数の帯と同じ目安でないと
// 「止まっているのに数えない」すれ違いが起きるため。
/** 回答 data の上限。項目数と JSON 全体の大きさの両方を見る。 */
const FORM_SUBMIT_DATA_MAX_FIELDS = 200;

export const FORM_SUBMIT_DATA_MAX_BYTES = 100 * 1024;

export /** 紐付けリンク id の上限。長すぎる値は受け付けない。 */
const FORM_SUBMIT_TRACKED_LINK_MAX_LENGTH = 128;

export /**
 * 一覧のサーバーページング（#1060）で `limit` が読めない値のときの既定。
 * 画面の既定表示件数と揃える。
 */
const FORM_LIST_PAGE_FALLBACK_LIMIT = 20;

export /** 一覧の絞り込み。知らない値は「すべて」へ落とす（画面と同じ規則）。 */
function validFormListFilter(value: string | undefined): FormListFilter {
  return value === 'published' || value === 'draft' || value === 'stored' || value === 'pending' || value === 'archived'
    ? value
    : 'all';
}

export /** 一覧の並び順。知らない値は「最新の回答順」へ落とす（画面と同じ規則）。 */
function validFormListSort(value: string | undefined): FormListSort {
  return value === 'answers' || value === 'updated' || value === 'name' ? value : 'latest-answer';
}

export function optionalExecutionCtx(c: Context<Env>): ExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    // Hono unit tests do not provide a Workers ExecutionContext.
    return undefined;
  }
}

export async function resolveFriendAccessToken(
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

export function serializeForm(
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
    warnings: (() => { const warning = formThemeContrastError(resolveCustomerFormTheme(parseLayout(row.layout, row.fields).options)); return warning ? [{ code: 'LOW_CONTRAST', message: warning }] : []; })(),
    id: row.id,
    name: row.name,
    description: row.description,
    fields: JSON.parse(row.fields || '[]') as Array<Record<string, unknown>>,
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
    publishedVersionId: row.current_published_version_id,
    folderId: row.folder_id ?? null,
    publishedContentRevision: row.published_content_revision ?? null,
    submitCount: row.submit_count,
    // P（一覧の数）：今月の数は一覧取得のときだけ付く。直接取得では
    // 未取得として null を返す（0 とは言わない）。
    monthlySubmitCount: (row as Partial<DbFormWithStats>).monthly_submit_count ?? null,
    monthlyOpenCount: (row as Partial<DbFormWithStats>).monthly_open_count ?? null,
    monthlyCompletionRate: (row as Partial<DbFormWithStats>).monthly_completion_rate ?? null,
    // ★V8 一覧の「後処理の未完」の札。一覧取得のときだけ付き、
    // それ以外は null（未完が無いとは言わない）。
    pendingPostActionCount:
      (row as Partial<DbFormWithStats>).pending_post_action_count ?? null,
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

export async function canUseFormFromAccount(
  c: Context<Env>,
  formId: string,
  accountId: string | undefined,
): Promise<boolean> {
  if (!accountId) return false;
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) return false;
  return formBelongsToLineAccount(c.env.DB, formId, accountId);
}

export /**
 * N-170 (#802): フォームの管理操作の関門。owner/adminは従来どおり通す。
 * それ以外は /form-submissions 鍵の完全一致とDB解決した所属を共通土台が決める。
 * readOnlyの更新拒否は鍵指定時の土台側とauthMiddlewareの両方で止まる。
 */
const FORM_MANAGE_PERMISSION_KEY = '/form-submissions';

export async function requireFormManage(
  c: Context<Env>,
  accountIds: Array<string | null | undefined>,
): Promise<Response | null> {
  const staff = c.get('staff');
  // 未認証は旧requireRoleと同じく403にする（400より先に判定する）。
  if (!staff) {
    return c.json({ success: false, error: 'この操作には管理者権限が必要です' }, 403);
  }
  if (staff.role === 'owner' || staff.role === 'admin') return null;
  const decision = await resolveRequestBoundaries(c.env.DB, staff, accountIds, {
    requiredPermissionKey: FORM_MANAGE_PERMISSION_KEY,
  });
  if (decision.allowed) return null;
  if (decision.reason === 'forbidden') {
    return c.json({ success: false, error: 'この機能を操作する権限がありません' }, 403);
  }
  return c.json({ success: false, error: 'Not found' }, 404);
}

export /** 選択中だけでなく、フォームが所属する全アカウントを扱える人だけが実行する。 */
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

export function publicWebhookConfig(row: DbForm): {
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

export function serializePublicForm(row: DbForm, layout = parseLayout(row.layout, row.fields)) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    fields: (JSON.parse(row.fields || '[]') as Array<{name: string}>).map(field => {
      const block = collectInputs(layout).find(block => block.name === field.name && block.fixedField === 'allergy' && block.type === 'checkbox');
      return block ? { ...field, options: block.choices?.map(choice => choice.label), columns: 2 } : field;
    }),
    layout,
    isActive: Boolean(row.is_active),
    onSubmitMessageContent: row.on_submit_message_content,
    onSubmitWebhookFailMessage: row.on_submit_webhook_fail_message,
    ...publicWebhookConfig(row),
  };
}

export /**
 * 回答の後処理の見え方(N-168)。一覧・詳細・再実行の応答で共有する。
 *
 * 送信は予約(claim)に工程を記録しながら進む。その記録と「あるべき工程」
 * を見比べて、失敗・中断で残った工程を運用者へ見せる。
 */
type SubmissionPostActions = FormSubmissionPostActions;

export function serializeSubmission(
  row: DbFormSubmission & { friend_name?: string | null },
  postActions?: SubmissionPostActions | null,
) {
  const publicAnswers = JSON.parse(row.data || '{}') as Record<string, unknown>;
  delete publicAnswers._webhookResult;
  return {
    id: row.id,
    formId: row.form_id,
    formVersionId: row.form_version_id,
    friendId: row.friend_id,
    friendName: row.friend_name || null,
    data: publicAnswers,
    destinationWrite: {
      status: row.destination_write_status ?? 'unknown',
      attempted: row.destination_write_attempted ?? null,
      succeeded: row.destination_write_succeeded ?? null,
      failed: row.destination_write_failed ?? null,
    },
    postActions: postActions ?? null,
    createdAt: row.created_at,
  };
}

export /**
 * 送信1件が通るはずの工程名の一覧(N-168)。
 *
 * 送信処理の締め(settleClaim)が要求する並びと同じにし、layout の内側の
 * 工程は `layout:<id>` で畳み込む。予約の記録に無いものが未完になる。
 * 回答は LINE 認証の友だちからしか作れないので、失敗通知の要否は
 * フォームの設定だけで決まる(友だち行の再検索は要らない)。
 */
function expectedSubmitStepNames(input: {
  config: {
    on_submit_webhook_url: string | null;
    on_submit_webhook_fail_message: string | null;
    save_to_metadata: number;
    on_submit_tag_id: string | null;
    on_submit_scenario_id: string | null;
  };
  layout: FormLayout | null;
  answers: Record<string, unknown>;
  /** 記録された Webhook 結果。無ければ未実行として扱う */
  webhook: { passed: boolean; data: unknown } | null;
}): string[] {
  const steps: string[] = [];
  const hasWebhook = Boolean(input.config.on_submit_webhook_url);
  if (hasWebhook) steps.push('webhook');
  if (hasWebhook && input.webhook?.passed === false) {
    // 連携に弾かれた回答はここで終わる(送信処理の早期returnと同じ並び)。
    if (input.config.on_submit_webhook_fail_message) steps.push('fail_message');
    steps.push('answer', 'submit_count', 'destination_status');
    return steps;
  }
  steps.push('answer', 'submit_count', 'mileage');
  if (input.config.save_to_metadata) steps.push('metadata');
  if (input.layout) {
    steps.push('layout_effects');
    for (const id of layoutEffectStepIds(input.layout, input.answers)) {
      steps.push(`layout:${id}`);
    }
  } else {
    steps.push('legacy_fields');
  }
  if (input.config.on_submit_tag_id) steps.push('tag');
  if (input.config.on_submit_scenario_id) steps.push('scenario');
  const webhookData = input.webhook?.data;
  if (webhookData && typeof webhookData === 'object'
    && (webhookData as Record<string, unknown>).join_url) {
    steps.push('meet_link');
  }
  steps.push('automation', 'reply', 'destination_status');
  return steps;
}

export /**
 * 回答1件の後処理の状態を組み立てる。
 *
 * 版の定義(回答時点の後処理の指定)を使って「あるべき工程」を決め、
 * 予約の記録に無いものを未完として返す。
 */
async function describeSubmissionPostActions(
  submission: DbFormSubmission,
  claim: FormSubmitClaim | null,
  config: {
    on_submit_webhook_url: string | null;
    on_submit_webhook_fail_message: string | null;
    save_to_metadata: number;
    on_submit_tag_id: string | null;
    on_submit_scenario_id: string | null;
    layout: string | null;
  },
): Promise<SubmissionPostActions> {
  if (!claim) return { state: 'untracked', pending: [], completed: [] };
  const steps = new Set(readFormSubmitClaimSteps(claim));
  let times: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(claim.step_completed_at_json ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) times = parsed as Record<string, unknown>;
  } catch { /* 旧記録の日時は不明のまま返す。 */ }
  const completed = [...steps].map(step => ({ step,
    completedAt: typeof times[step] === 'string' && Number.isFinite(Date.parse(times[step] as string))
      ? times[step] as string : null,
  }));
  // 完了済みの予約は未完を計算しない。この機能より前の完了分には
  // layout の内側の工程記録が無く、あるべき工程との差分で「未完」に
  // 見えてしまうため。
  if (claim.status === 'completed') return { state: 'completed', pending: [], completed };
  let webhook: { passed: boolean; data: unknown } | null = null;
  try {
    webhook = claim.webhook
      ? JSON.parse(claim.webhook) as { passed: boolean; data: unknown }
      : null;
  } catch {
    webhook = null;
  }
  const answers = JSON.parse(submission.data || '{}') as Record<string, unknown>;
  delete answers._webhookResult;
  const layout = config.layout ? parseLayout(config.layout) : null;
  const expected = expectedSubmitStepNames({ config, layout, answers, webhook });
  return { state: claim.status, pending: expected.filter((step) => !steps.has(step)), completed };
}

export /**
 * 回答一覧用のまとめて組み立て。予約と版の定義を IN 句で1回ずつ読む。
 * 版が無い古い回答は公開中の定義(fallback)で見る。
 */
async function describePostActionsForSubmissions(
  db: D1Database,
  items: DbFormSubmission[],
  fallbackConfig: {
    on_submit_webhook_url: string | null;
    on_submit_webhook_fail_message: string | null;
    save_to_metadata: number;
    on_submit_tag_id: string | null;
    on_submit_scenario_id: string | null;
    layout: string | null;
  },
): Promise<Map<string, SubmissionPostActions>> {
  const [claims, versions] = await Promise.all([
    getFormSubmitClaimsBySubmissionIds(db, items.map((item) => item.id)),
    getFormVersionContentsByIds(
      db,
      items
        .map((item) => item.form_version_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]);
  const map = new Map<string, SubmissionPostActions>();
  for (const item of items) {
    const config = (item.form_version_id ? versions.get(item.form_version_id) : null)
      ?? fallbackConfig;
    map.set(
      item.id,
      await describeSubmissionPostActions(item, claims.get(item.id) ?? null, config),
    );
  }
  return map;
}

export /** 回答内容のハッシュ。同じキーの再送が同じ回答かを照合する。 */
async function hashIdempotentSubmission(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export /** 期限切れの予約。再送は受け付けず、新しいキーでの送り直しを求める。 */
function formSubmitClaimExpired(claim: Pick<FormSubmitClaim, 'expires_at'>): boolean {
  if (!claim.expires_at) return false;
  const expiresAt = Date.parse(claim.expires_at);
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

export /** 止まったとみなす基準時刻(JST 文字列で比較する)。 */
function formSubmitClaimStaleBefore(): string {
  return toJstString(new Date(Date.now() - FORM_SUBMIT_CLAIM_STALE_MS));
}

export /**
 * 再送の応答。保存時と同じ形を返し、連携の成否も再現する。
 * 連携で弾かれた回答の再送は、弾かれたときの結果のまま返す。
 */
function serializeIdempotentReplay(row: DbFormSubmission): Record<string, unknown> {
  const base = serializeSubmission(row) as Record<string, unknown>;
  try {
    const data = JSON.parse(row.data || '{}') as Record<string, unknown>;
    if ('_webhookResult' in data) {
      return { ...base, webhookPassed: false, webhookData: publicFormWebhookData(data._webhookResult) };
    }
  } catch {
    // 壊れた回答は基本形のまま返す
  }
  return base;
}

export /**
 * 処理の途中で予約の所有者を失った合図。横取りした試行と副作用を重ねない
 * よう、その場で止めて送り直しの応答を持ち帰る。
 */
class ClaimOwnershipLost {
  constructor(readonly response: Response) {}
}

export function dateFieldsOfForm(form: DbForm): Array<{ key: string; label: string }> {
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

export function ratingFieldsOfForm(form: DbForm): Array<{ key: string; label: string }> {
  const layout = form.layout ? parseLayout(form.layout, form.fields) : null;
  if (layout) {
    return collectInputs(layout)
      .filter((block) => block.type === 'rating' && block.name)
      .map((block) => ({ key: block.name, label: block.label || block.name }));
  }
  return parseFormFields(form.fields)
    .filter((field) => field.type === 'rating')
    .map((field) => ({
      key: field.name ?? field.id ?? '',
      label: field.label ?? field.name ?? field.id ?? '',
    }))
    .filter((field) => field.key);
}

export function displayAnswerValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'object') {
    const formatted = formatAddressValue(value);
    return formatted === '' ? '-' : formatted;
  }
  return String(value);
}
