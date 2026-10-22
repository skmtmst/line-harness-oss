import { logger } from '@line-crm/shared/server';
import { formWebhookTarget } from '../services/public-https-request.js';
import { webhookUrlBlockReason } from '../services/outgoing-webhook-delivery.js';
import { validateLayoutRouting } from '../features/forms/form-routing/index.js';
import { GapError } from '../services/gap-common.js';
import { normalizeLayoutInput } from './form-layout-input.js';
import { hasDeliveryAccess } from '@line-crm/shared';
import { inputError } from '../lib/input-errors.js';
import { formAvailability } from '../features/forms/form-availability/index.js';
import { applyAccountAllergyOptions } from '../services/allergy-options.js';
import { accountCustomerLook } from '../services/customer-look.js';
import { resolveCustomerFormTheme } from '@line-crm/shared';

import { getFormsWithStats, getFormById, getFormLatestEdit, getFormAccountIds, getFolderById, formBelongsToLineAccount, createForm, updateForm, setFormFolder, publishFormVersion, type UpdateFormInput, countActiveFormTestTokens, insertFormTestToken, deleteExpiredFormTestTokens, getFriendByLineUserIdForAccount, jstNow, toJstString } from '@line-crm/db';

import { verifyCallerLineIdentity } from '../services/liff-auth.js';
import { listLimit, listPage } from './list-pagination.js';
import type { Env } from '../worker-env.js';

import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { legacyFormFieldTypeError, parseLayout, validateFormForPublish, DEFAULT_TENANT_ID } from '@line-crm/shared';
import { formMatchesListFilter, formMatchesListQuery, sortFormListItems } from '@line-crm/shared';
import { serializeForm, validFormListFilter, validFormListSort, FORM_LIST_PAGE_FALLBACK_LIMIT, stoppedPublicFormResponse, readFormTestToken, verifyFormTestToken, serializePublicForm, canUseFormFromAccount, requireFormManage, FORM_TEST_TOKEN_MAX_ACTIVE, FORM_TEST_TOKEN_TTL_MS, sha256Hex, authorizedDeleteImpact } from './forms-definition.js';
import type { Context } from 'hono';

function validWebhookTemplate(value: string): boolean {
  try { return !webhookUrlBlockReason(formWebhookTarget(value, {})); } catch { return false; }
}
export const get__api_forms_1 = async (c: Context<Env, "/api/forms">) => {
  const accountId = c.req.query('account_id');
  if (!accountId) {
    return c.json({ success: false, error: 'account_id is required' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  // N-175 (#805): folder条件もサーバーで絞る。kind=formの既存フォルダだけ受け付け、
  // 存在なし・異種別はfail-closedにする。未分類はfolder_id IS NULLで絞る。
  const folderParam = c.req.query('folder_id')?.trim();
  let folderScope: { folderId?: string; unfiledOnly?: boolean } = {};
  if (folderParam !== undefined && folderParam !== '' && folderParam !== 'all') {
    if (folderParam === 'unfiled') {
      folderScope = { unfiledOnly: true };
    } else {
      const folder = await getFolderById(c.env.DB, folderParam);
      if (!folder || folder.kind !== 'form') {
        return c.json({ success: false, error: 'Not found' }, 404);
      }
      folderScope = { folderId: folder.id };
    }
  }
  const items = await getFormsWithStats(c.env.DB, { lineAccountIds: [accountId], status: c.req.query('filter') === 'archived' ? 'archived' : 'active', ...folderScope });
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
    /*
     * #1060: サーバーページング。これまで画面が全件を受け取ってから
     * 絞り込み・並び替え・ページ切りをしていた。`limit`（+`page`）と
     * `q` / `filter` / `sort` を新たに受け付け、Worker 側で同じ規則を
     * 適用してから切り出す。規則の正本は @line-crm/shared に寄せてある。
     * `limit` 未指定なら従来どおり全件を返す（既存呼び出しを壊さない）。
     *
     * `total` は絞り込み後の件数（ページ送りの母数）、`all_total` は
     * フォルダ範囲だけの件数（フォルダ欄の「すべて」の件数表示用）。
     */
    const filter = validFormListFilter(c.req.query('filter'));
    const sort = validFormListSort(c.req.query('sort'));
    const search = c.req.query('q') ?? '';
    const allTotal = data.length;
    let list = data;
    if (filter !== 'all') {
      list = list.filter((row) => formMatchesListFilter(row, filter));
    }
    if (search.trim() !== '') {
      list = list.filter((row) => formMatchesListQuery(row, search));
    }
    list = sortFormListItems(list, sort);
    const total = list.length;
    const limitParam = c.req.query('limit');
    if (limitParam !== undefined && limitParam.trim() !== '') {
      const limit = listLimit(limitParam, FORM_LIST_PAGE_FALLBACK_LIMIT);
      const page = listPage(c.req.query('page'));
      const items = list.slice((page - 1) * limit, (page - 1) * limit + limit);
      return c.json({
        success: true,
        data: { items, total, all_total: allTotal, page, limit },
      });
    }
    return c.json({
      success: true,
      data: { items: list, total, all_total: allTotal, page: 1, limit: list.length },
    });
  }
  return c.json({ success: true, data });
};

export const get__api_forms_unassigned_2 = async (c: Context<Env, "/api/forms/unassigned">) => {
  const accountId = c.req.query('account_id');
  if (!accountId) {
    return c.json({ success: false, error: 'account_id is required' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const staff = c.get('staff');
  if ((staff?.tenantId ?? DEFAULT_TENANT_ID) !== DEFAULT_TENANT_ID) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const scope = await getVisibleLineAccountScope(c.env.DB, staff);
  if (!scope.canSeeUnassigned) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const items = await getFormsWithStats(c.env.DB, { lineAccountIds: [], includeUnassigned: true });
  const data = items.map((row) =>
    serializeForm(row, {
      lastSubmittedAt: row.last_submitted_at,
      usedByAccounts: row.used_by_accounts,
      accountScopeReviewRequired: row.account_scope_review_required,
    }),
  );
  return c.json({ success: true, data });
};

export const get__api_forms_id_3 = async (c: Context<Env, "/api/forms/:id">) => {
  const stopped = await stoppedPublicFormResponse(c, c.req.param('id'));
  if (stopped) return stopped;
  const id = c.req.param('id');
  const staff = c.get('staff');
  // P（試し回答）：試し合言葉が正しければ、下書きをお客さまの形で返す。
  // 公開版が無くても試せる。秘密は公開形にしないので漏れない。
  // 合言葉が違うときは本物として扱わず、試しだと分かる文で断る。
  const presentedTestToken = readFormTestToken(c);
  if (presentedTestToken) {
    if (!await verifyFormTestToken(c.env.DB, id, presentedTestToken)) {
      return c.json({ success: false, error: '試し合言葉が無効です。管理画面から取り直してください' }, 403);
    }
    const draft = await getFormById(c.env.DB, id);
    if (!draft) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const testAccounts = await getFormAccountIds(c.env.DB, id);
    let testLayout = parseLayout(draft.layout, draft.fields);
    const testAccountId = testAccounts.length === 1 ? testAccounts[0] : null;
    if (testAccountId) testLayout = await applyAccountAllergyOptions(c.env.DB, testAccountId, testLayout);
    const testLook = testAccountId ? (await accountCustomerLook(c.env.DB, testAccountId)).look : undefined;
    testLayout = {...testLayout, options: {...testLayout.options, theme: resolveCustomerFormTheme(testLayout.options, testLook)}};
    return c.json({ success: true, data: { ...serializePublicForm(draft, testLayout), isTest: true, availability: await formAvailability({ db: c.env.DB, formId: id, layout: testLayout, active: !!draft.is_active, submitCount: draft.submit_count ?? 0, friendId: null, isTest: true }) } });
  }
  // ログイン中の運用者が公開URLを開いても、account_id を明示した管理画面取得で
  // ない限り下書きを漏らさない。
  const adminView = Boolean(staff && c.req.query('account_id'));
  const form = await getFormById(c.env.DB, id, { published: !adminView });
  if (!form) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  if (adminView && !await canUseFormFromAccount(c, id, c.req.query('account_id'))) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  let friendId: string | null = null;
  let layout = parseLayout(form.layout, form.fields);
  let publicAccountId: string | null = null;
  if (!adminView && !staff && c.req.header('Authorization')) {
    const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
    if (!identity) return c.json({ success: false, error: 'Unauthorized' }, 401);
    if (!identity.lineAccountId || !await formBelongsToLineAccount(c.env.DB, id, identity.lineAccountId)) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    friendId = (await getFriendByLineUserIdForAccount(c.env.DB, identity.lineUserId, identity.lineAccountId))?.id ?? null;
    publicAccountId = identity.lineAccountId;
  }
  if (!adminView && !publicAccountId) {
    const accounts = await getFormAccountIds(c.env.DB, id);
    if (accounts.length === 1) publicAccountId = accounts[0];
  }
  if (publicAccountId) layout = await applyAccountAllergyOptions(c.env.DB, publicAccountId, layout);
  if (!adminView) {
    const look = publicAccountId ? (await accountCustomerLook(c.env.DB, publicAccountId)).look : undefined;
    layout = {...layout, options: {...layout.options, theme: resolveCustomerFormTheme(layout.options, look)}};
  }
  const data = adminView
    ? {...serializeForm(form, undefined, { redactSecrets: staff.role === 'staff' }),latestEdit:await getFormLatestEdit(c.env.DB,id,form.content_revision)}
    : { ...serializePublicForm(form, layout), availability: await formAvailability({
      db: c.env.DB, formId: id, layout, active: !!form.is_active,
      submitCount: form.submit_count ?? 0, friendId,
    }) };
  return c.json({ success: true, data });
};

export const post__api_forms_id_publish_4 = async (c: Context<Env, "/api/forms/:id/publish">) => {
  const id = c.req.param('id');
  const manageGate = await requireFormManage(c, await getFormAccountIds(c.env.DB, id));
  if (manageGate) return manageGate;
  if (!await canUseFormFromAccount(c, id, c.req.query('account_id'))) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  const body = await c.req.json<{ expectedContentRevision?: unknown }>()
    .catch(() => ({} as { expectedContentRevision?: unknown }));
  const expected = typeof body.expectedContentRevision === 'number'
    ? body.expectedContentRevision
    : Number.NaN;
  if (!Number.isInteger(expected) || expected < 1) {
    return inputError(c, { success: false, error: '確認した版が必要です' }, 400, ["expectedContentRevision"]);
  }
  // 公開前の検査。下書きでは許すが公開では止めるもの——分岐の循環・
  // 消えた行き先・共通ヘッダの分岐・選ぶ先が空の動作——をここで止める。
  // 版がずれている場合は publish 側が 409 を返すので、確認できた版の
  // 内容だけを検査する。
  const draft = await getFormById(c.env.DB, id);
  if (draft && draft.content_revision === expected) {
    const normalized = normalizeLayoutInput(parseLayout(draft.layout, draft.fields));
    if (normalized && 'error' in normalized) return inputError(c, { success: false, error: normalized.error }, 400, ['layout']);
    const publishError = validateFormForPublish(parseLayout(draft.layout, draft.fields));
    if (publishError) {
      return inputError(c, { success: false, error: publishError }, 400, ["layout"]);
    }
  }
  const result = await publishFormVersion(c.env.DB, id, expected);
  if (result.kind === 'not_found') {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  if (result.kind === 'conflict') {
    return c.json({
      success: false,
      error: 'form_content_changed',
      message: 'ほかの人が先に保存しました。最新の内容を読み込んでから、もう一度お試しください。',
      data: {
        contentRevision: result.form.content_revision,
        updatedAt: result.form.updated_at,
      },
    }, 409);
  }
  return c.json({
    success: true,
    data: {
      id: result.version.id,
      versionNumber: result.version.version_number,
      contentRevision: result.form.content_revision,
      publishedAt: result.version.published_at,
      replayed: result.replayed,
    },
  });
};

export const post__api_forms_id_test_token_5 = async (c: Context<Env, "/api/forms/:id/test-token">) => {
  const id = c.req.param('id');
  const manageGate = await requireFormManage(c, await getFormAccountIds(c.env.DB, id));
  if (manageGate) return manageGate;
  if (!await canUseFormFromAccount(c, id, c.req.query('account_id'))) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  const draft = await getFormById(c.env.DB, id);
  if (!draft) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  const now = jstNow();
  await deleteExpiredFormTestTokens(c.env.DB, now);
  const active = await countActiveFormTestTokens(c.env.DB, id, now);
  if (active >= FORM_TEST_TOKEN_MAX_ACTIVE) {
    return c.json(
      { success: false, error: '試し合言葉が上限（5件）に達しています。期限切れを待ってから、もう一度お試しください' },
      429,
    );
  }
  const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const expiresAt = toJstString(new Date(Date.now() + FORM_TEST_TOKEN_TTL_MS));
  const staff = c.get('staff');
  await insertFormTestToken(c.env.DB, {
    id: crypto.randomUUID(),
    formId: id,
    tokenHash: await sha256Hex(token),
    createdByStaffId: typeof staff?.id === 'string' ? staff.id : null,
    expiresAt,
  });
  // 生の合言葉はこの応答でしか返さない。台帳からは読み出せない。
  return c.json({ success: true, data: { token, expiresAt } });
};

export const post__api_forms_6 = async (c: Context<Env, "/api/forms">) => {
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
    return inputError(c, { success: false, error: 'name is required' }, 400, ["name"]);
  }
  const createGate = await requireFormManage(c, [body.accountId]);
  if (createGate) return createGate;
  if (!body.accountId) {
    return inputError(c, { success: false, error: 'accountId is required' }, 400, ["accountId"]);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }

  if (body.fields !== undefined && body.layout === undefined) {
    const fieldError = legacyFormFieldTypeError(body.fields);
    if (fieldError) return c.json({ success: false, error: fieldError }, 400);
  }
  if (body.onSubmitWebhookUrl && !validWebhookTemplate(body.onSubmitWebhookUrl)) return inputError(c, { success: false, error: '公開HTTPSの固定ホストを指定してください' }, 400, ['onSubmitWebhookUrl']);
  const normalized = body.layout !== undefined ? normalizeLayoutInput(body.layout) : null;
  if (normalized && 'error' in normalized) {
    return inputError(c, { success: false, error: normalized.error }, 400, ["layout"]);
  }
  if (body.layout !== undefined && !normalized) {
    return inputError(c, { success: false, error: 'layout の形が正しくありません' }, 400, ["layout"]);
  }
  if (normalized && !('error' in normalized) && normalized.layout) {
    try { await validateLayoutRouting(c.env.DB, body.accountId, JSON.parse(normalized.layout)); }
    catch(e) { if(e instanceof GapError)return c.json({success:false,error:e.code},e.status);throw e; }
  }

  const form = await createForm(c.env.DB, {
    name: body.name,
    isActive: hasDeliveryAccess(c.get('staff'), 'forms', 'publish'),
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
};

export const post__api_forms_drafts_7 = async (c: Context<Env, "/api/forms/drafts">) => {
  const body = await c.req.json<{ name?: string; accountId?: string }>()
    .catch(() => ({} as { name?: string; accountId?: string }));
  const draftsGate = await requireFormManage(c, [body.accountId]);
  if (draftsGate) return draftsGate;
  if (!body.accountId) {
    return inputError(c, { success: false, error: 'accountId is required' }, 400, ["accountId"]);
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
};

export const post__api_forms_id_duplicate_8 = async (c: Context<Env, "/api/forms/:id/duplicate">) => {
  const id = c.req.param('id');
  const accountIds = await getFormAccountIds(c.env.DB, id);
  const duplicateGate = await requireFormManage(c, accountIds);
  if (duplicateGate) return duplicateGate;
  const source = await getFormById(c.env.DB, id);
  if (!source) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  const requestAccountId = c.req.query('account_id');
  if (requestAccountId && !await canUseFormFromAccount(c, id, requestAccountId)) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  const body = await c.req.json<{ name?: unknown }>()
    .catch(() => ({} as { name?: unknown }));
  const requestedName = typeof body.name === 'string' ? body.name.trim() : '';
  const name = (requestedName || `${source.name}の複製`).slice(0, 200);
  const copy = await createForm(c.env.DB, {
    name,
    description: source.description,
    fields: source.fields,
    layout: source.layout,
    onSubmitTagId: source.on_submit_tag_id,
    onSubmitScenarioId: source.on_submit_scenario_id,
    onSubmitMessageType: source.on_submit_message_type,
    onSubmitMessageContent: source.on_submit_message_content,
    onSubmitWebhookUrl: source.on_submit_webhook_url,
    onSubmitWebhookHeaders: source.on_submit_webhook_headers,
    onSubmitWebhookFailMessage: source.on_submit_webhook_fail_message,
    saveToMetadata: source.save_to_metadata === 1,
    ogTitle: source.og_title,
    ogDescription: source.og_description,
    ogImageUrl: source.og_image_url,
    // 公開中の写しを作らない。編集画面で中身を整えてから公開する。
    isActive: false,
    lineAccountIds: accountIds,
  });
  /*
   * 所属フォルダも引き継ぐ。消えた箱・別用途の箱は付けない（PUT の
   * folderId と同じ決まり）。箱が無くても複製自体は作る。
   */
  if (source.folder_id) {
    const folder = await getFolderById(c.env.DB, source.folder_id);
    if (folder && folder.kind === 'form') {
      await setFormFolder(c.env.DB, copy.id, source.folder_id);
    }
  }
  const withFolder = source.folder_id ? await getFormById(c.env.DB, copy.id) : copy;
  return c.json({ success: true, data: serializeForm(withFolder ?? copy) }, 201);
};

export const put__api_forms_id_9 = async (c: Context<Env, "/api/forms/:id">) => {
  const id = c.req.param('id');
  const putGate = await requireFormManage(c, await getFormAccountIds(c.env.DB, id));
  if (putGate) return putGate;
  if (!await canUseFormFromAccount(c, id, c.req.query('account_id'))) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  const body = await c.req.json<{
    name?: string;
    description?: string | null;
    fields?: unknown[];
    layout?: unknown;
    folderId?: string | null;
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

  if (body.onSubmitWebhookUrl && !validWebhookTemplate(body.onSubmitWebhookUrl)) return inputError(c, { success: false, error: '公開HTTPSの固定ホストを指定してください' }, 400, ['onSubmitWebhookUrl']);
  if (body.isActive !== undefined && !hasDeliveryAccess(c.get('staff'), 'forms', 'publish')) return c.json({ success: false, error: '公開・停止には管理者権限が必要です' }, 403);

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
  /*
   * R25: フォルダへの移し変え（`folderId`）は、中身の更新と一緒でなければ
   * 版の確認を要しない。所属は版管理の対象外で、確認を強いると一覧からの
   * 移動のたびに詳細の取得が要る。#723 の例外ではなく、中身が無い要求に
   * 対して確認する版が無いだけ。**中身の更新と一緒のときは確認を免除しない。**
   * 複合保存は内容と所属を同じ条件付き UPDATE で書く。先に所属だけ
   * 動かすと、400・422・409 のとき移動だけが残る。
   */
  const hasContentUpdate = Object.keys(body).some((key) => key !== 'folderId');
  if (hasContentUpdate && (!Number.isInteger(expectedContentRevision) || expectedContentRevision < 1)) {
    return inputError(c, { success: false, error: '確認した版が必要です' }, 400, ["expectedContentRevision"]);
  }

  let nextFolderId: string | null | undefined;
  if ('folderId' in body) {
    const rawFolderId = body.folderId;
    nextFolderId = rawFolderId === null || rawFolderId === '' ? null : String(rawFolderId);
    if (nextFolderId !== null) {
      // テンプレートの `readFolderId` と同じ決まり。消えた箱・別用途の箱・
      // 別アカウントの箱は断る。**黙って未分類にしない。**
      const folder = await getFolderById(c.env.DB, nextFolderId);
      const requestAccountId = c.req.query('account_id');
      if (!folder || folder.kind !== 'form'
        || (folder.account_id !== null && folder.account_id !== requestAccountId)) {
        return inputError(c, { success: false, error: 'そのフォルダはありません' }, 422, ["folderId"]);
      }
    }
    if (!hasContentUpdate) {
      if (!await setFormFolder(c.env.DB, id, nextFolderId)) {
        return c.json({ success: false, error: 'Form not found' }, 404);
      }
      const moved = await getFormById(c.env.DB, id);
      if (!moved) return c.json({ success: false, error: 'Form not found' }, 404);
      return c.json({ success: true, data: serializeForm(moved) });
    }
  }

  // Only include fields that were explicitly sent (avoid undefined → null conversion)
  const updates: Record<string, unknown> = {};
  if ('folderId' in body) updates.folderId = nextFolderId;
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.fields !== undefined && body.layout === undefined) {
    const fieldError = legacyFormFieldTypeError(body.fields);
    if (fieldError) return c.json({ success: false, error: fieldError }, 400);
  }
  if (body.fields !== undefined) updates.fields = JSON.stringify(body.fields);
  // layout を受け取ったときは、fields もそこから作り直す。片方だけ新しい
  // 状態にすると、送信時の必須チェックが古い項目を見に行く。
  if (body.layout !== undefined) {
    const normalized = normalizeLayoutInput(body.layout);
    if (!normalized) {
      return inputError(c, { success: false, error: 'layout の形が正しくありません' }, 400, ["layout"]);
    }
    if ('error' in normalized) {
      return inputError(c, { success: false, error: normalized.error }, 400, ["layout"]);
    }
    try { for(const account of await getFormAccountIds(c.env.DB,id)) await validateLayoutRouting(c.env.DB,account,JSON.parse(normalized.layout)); }
    catch(e) { if(e instanceof GapError)return c.json({success:false,error:e.code},e.status);throw e; }
    updates.layout = normalized.layout;
    updates.fields = normalized.fields;
  }
  if (body.onSubmitTagId !== undefined) updates.onSubmitTagId = body.onSubmitTagId;
  if (body.onSubmitScenarioId !== undefined) updates.onSubmitScenarioId = body.onSubmitScenarioId;
  if (body.onSubmitMessageType !== undefined) updates.onSubmitMessageType = body.onSubmitMessageType;
  if (body.onSubmitMessageContent !== undefined) updates.onSubmitMessageContent = body.onSubmitMessageContent;
  if (body.onSubmitWebhookUrl !== undefined) updates.onSubmitWebhookUrl = body.onSubmitWebhookUrl;
  if (body.onSubmitWebhookUrl !== undefined && body.onSubmitWebhookHeaders === undefined) {
    const previous = await getFormById(c.env.DB, id);
    if (!previous) return c.json({ success: false, error: 'Form not found' }, 404);
    // The existing content-revision CAS fences this read with the update.
    // An editor who cannot reveal a saved credential cannot carry it to a
    // newly chosen origin. Explicit new credentials belong to that new origin.
    const origin = (value: string | null): string | null => {
      try { return value ? new URL(value).origin : null; } catch { return null; }
    };
    if (origin(previous.on_submit_webhook_url) !== origin(body.onSubmitWebhookUrl)) updates.onSubmitWebhookHeaders = null;
  }
  if (body.onSubmitWebhookHeaders !== undefined) updates.onSubmitWebhookHeaders = body.onSubmitWebhookHeaders;
  if (body.onSubmitWebhookFailMessage !== undefined) updates.onSubmitWebhookFailMessage = body.onSubmitWebhookFailMessage;
  if (body.saveToMetadata !== undefined) updates.saveToMetadata = body.saveToMetadata;
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.ogTitle !== undefined) updates.ogTitle = body.ogTitle;
  if (body.ogDescription !== undefined) updates.ogDescription = body.ogDescription;
  if (body.ogImageUrl !== undefined) updates.ogImageUrl = body.ogImageUrl;

  const updated = await updateForm(c.env.DB, id, updates as UpdateFormInput, expectedContentRevision,c.get('staff')?.id);

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
        latestEdit:await getFormLatestEdit(c.env.DB,id,updated.form.content_revision),
      },
    }, 409);
  }

  return c.json({ success: true, data: {...serializeForm(updated.form),latestEdit:await getFormLatestEdit(c.env.DB,id,updated.form.content_revision)} });
};

export const get__api_forms_id_delete_impact_10 = async (c: Context<Env, "/api/forms/:id/delete-impact">) => {
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
    logger.error("forms.forms_id_delete_impact_get_failed");
    return c.json({ success: false, error: '削除したときの影響を確認できませんでした' }, 503);
  }
};
