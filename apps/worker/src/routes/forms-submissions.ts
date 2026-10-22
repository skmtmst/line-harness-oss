import { logger } from '@line-crm/shared/server';
import { auditLog } from '../lib/audit-log.js';
import { reportPeriod, type ReportPeriodInput } from '@line-crm/shared';
import { parseLayout } from '@line-crm/shared';

import { callFormWebhook, publicFormWebhookData } from '../features/forms/form-webhook/index.js';
import { customerDeletionPending, deleteCustomerData, deletionJournal, DeletionFailure } from '../services/customer-data-deletion.js';
import { inputError } from '../lib/input-errors.js';
import { hydrateDocumentAnswers } from '../features/forms/form-documents/index.js';

import { getFormById, type FormSubmitClaimScope, getFormAccountIds, getFormDeleteImpact, archiveFormAtRevision, unarchiveFormAtRevision, deleteFormAtRevision, getFormSubmissions, getFormSubmissionsPage, getFormSubmissionAnalytics, getFormSubmissionById, resyncFormSubmitCount, getFormSubmitClaim, takeoverFormSubmitClaim, readFormSubmitClaimSteps, appendFormSubmitClaimStep, saveFormSubmitClaimWebhook, completeFormSubmitClaim, failFormSubmitClaim, ensureFormSubmitOutboxEvent, getFormSubmitOutbox, markFormSubmitOutboxDelivered, readFormSubmitOutboxPayload, readFormSubmitClaimEffectStats, saveFormSubmitClaimEffectStats, getFormSubmitClaimBySubmissionId, getFormVersionContent, updateFormSubmissionDestinationWriteResult, getFriendById, toJstString } from '@line-crm/db';

import { pushViaHarnessProxy } from '../services/line-proxy-send.js';
import { dispatchLineProxyLocally } from '../services/local-line-proxy.js';
import { listLimit, listPage } from './list-pagination.js';
import type { Env } from '../worker-env.js';

import { canAccessAllLineAccounts } from '../services/account-access.js';
import { createBroadcastRetryKey } from '../features/broadcasts/broadcast-retry-key/index.js';

import { authorizedDeleteImpact, requireFormManage, canUseFormFromAccount, NON_PAGINATED_SUBMISSIONS_MAX, describePostActionsForSubmissions, serializeSubmission, dateFieldsOfForm, ratingFieldsOfForm, describeSubmissionPostActions, formSubmitClaimExpired, formSubmitClaimStaleBefore, FormSubmitClaimHandle, ClaimOwnershipLost, resolveFriendAccessToken, optionalExecutionCtx, runFormPostEffects } from './forms-definition.js';
import type { Context } from 'hono';

export const post__api_forms_id_archive_1 = async (c: Context<Env, "/api/forms/:id/archive">) => {
  try {
    const accountId = c.req.query('account_id')?.trim();
    if (!accountId) return inputError(c, { success: false, error: 'account_id is required' }, 400, ["account_id"]);
    const body = await c.req.json<Record<string, unknown>>();
    const expectedRevision = typeof body.expectedRevision === 'number'
      ? body.expectedRevision
      : Number.NaN;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return inputError(c, { success: false, error: '確認した版が必要です' }, 400, ["expectedRevision"]);
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
    logger.error("forms.forms_id_archive_post_failed");
    return c.json({ success: false, error: '回答フォームを保管できませんでした' }, 503);
  }
};

export const post__api_forms_id_unarchive_2 = async (c: Context<Env, "/api/forms/:id/unarchive">) => {
  try {
    const accountId = c.req.query('account_id')?.trim();
    if (!accountId) return inputError(c, { success: false, error: 'account_id is required' }, 400, ["account_id"]);
    const body = await c.req.json<Record<string, unknown>>();
    const expectedRevision = typeof body.expectedRevision === 'number'
      ? body.expectedRevision
      : Number.NaN;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return inputError(c, { success: false, error: '確認した版が必要です' }, 400, ["expectedRevision"]);
    }

    const authorized = await authorizedDeleteImpact(c, c.req.param('id'), accountId);
    if (authorized.kind === 'not_found') {
      return c.json({ success: false, error: 'not found' }, 404);
    }
    if (authorized.kind === 'forbidden') {
      return c.json({ success: false, error: 'すべての利用先を確認する権限がありません' }, 403);
    }
    if (authorized.impact.form.status !== 'archived') {
      return c.json({
        success: false,
        error: 'form_not_archived',
        message: 'この回答フォームは保管されていないため、元に戻せません。',
        data: authorized.impact,
      }, 409);
    }
    if (authorized.impact.revision !== expectedRevision) {
      return c.json({
        success: false,
        error: 'form_delete_changed',
        message: '影響が変わりました。最新の状態を読み直してください。',
        data: authorized.impact,
      }, 409);
    }

    const unarchived = await unarchiveFormAtRevision(c.env.DB, c.req.param('id'), expectedRevision);
    if (!unarchived) {
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
        status: 'active',
        revision: unarchived.revision,
        isActive: Boolean(unarchived.is_active),
      },
    });
  } catch (error) {
    logger.error("forms.forms_id_unarchive_post_failed");
    return c.json({ success: false, error: '回答フォームを元に戻せませんでした' }, 503);
  }
};

export const delete__api_forms_id_3 = async (c: Context<Env, "/api/forms/:id">) => {
  try {
    const id = c.req.param('id');
    const accountId = c.req.query('account_id')?.trim();
    const expectedRevision = Number(c.req.query('expected_revision'));
    if (!accountId) return c.json({ success: false, error: 'account_id is required' }, 400);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return c.json({ success: false, error: '確認した版が必要です' }, 400);
    }
    const deleteGate = await requireFormManage(c, await getFormAccountIds(c.env.DB, id));
    if (deleteGate) return deleteGate;
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
    logger.error("forms.forms_id_delete_failed");
    return c.json({ success: false, error: '削除したときの影響を確認できませんでした' }, 503);
  }
};

export const delete__api_forms_id_submissions_submissionId_4 = async (c: Context<Env, "/api/forms/:id/submissions/:submissionId">) => {
  const formId = c.req.param('id'), submissionId = c.req.param('submissionId');
  try {
    const accountId = c.req.query('account_id');
    if (!accountId || !await canUseFormFromAccount(c, formId, accountId)) return c.json({ success: false, error: '回答が見つかりません' }, 404);
    const journal = await deletionJournal(c.env.DB, 'form_response', submissionId);
    if (journal && (journal.detail.accountId !== accountId || journal.detail.formId !== formId)) return c.json({ success: false, error: '回答が見つかりません' }, 404);
    if (journal?.action === 'deleted') return c.json({ success: true, data: { deleted: true, replayed: true } });
    const submission = await getFormSubmissionById(c.env.DB, submissionId);
    if (!submission || submission.form_id !== formId) return c.json({ success: false, error: '回答が見つかりません' }, 404);
    const friend = submission.friend_id ? await getFriendById(c.env.DB, submission.friend_id) : null;
    if (!friend && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), await getFormAccountIds(c.env.DB, formId))) return c.json({ success: false, error: '回答が見つかりません' }, 404);
    if (friend && ((friend as unknown as { line_account_id: string | null }).line_account_id !== accountId)) return c.json({ success: false, error: '回答が見つかりません' }, 404);
    const data = await deleteCustomerData(c.env, { kind: 'form_response', id: submissionId, formId, friendId: submission.friend_id, accountId }, c.get('staff')!.id);
    return c.json({ success: true, data });
  } catch (error) {
    if (error instanceof DeletionFailure && error.code === 'deletion_schema_approval_required') return c.json({ success: false, code: error.code, error: '支払・監査の記録を残すため、データ構造の変更承認が必要です。オーナーか管理者に頼んでください。' }, 409);
    if (error instanceof DeletionFailure) return c.json({ success: false, code: error.code, error: error.status === 409 ? '削除中です。少し待ってから、もう一度お試しください。' : '削除を完了できませんでした。同じ回答で、もう一度削除してください。' }, error.status);
    return c.json({ success: false, code: 'deletion_retry_required', error: '削除を完了できませんでした。同じ回答で、もう一度削除してください。' }, 503);
  }
};

export const post__api_forms_id_exports_5 = async (c: Context<Env, "/api/forms/:id/exports">) => {
  const id = c.req.param('id');
  const accountId = c.req.query('account_id');
  if (!await canUseFormFromAccount(c, id, accountId)) return c.json({ success: false, error: 'Form not found' }, 404);
  const form = await getFormById(c.env.DB, id);
  if (!form) return c.json({ success: false, error: 'Form not found' }, 404);
  const fields = JSON.parse(form.fields || '[]') as Array<{ id?: string; name: string; label?: string }>;
  const cell = (value: unknown) => {
    let text = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const rows: string[] = [['回答ID', '回答日時', ...fields.map(f => f.label ?? f.name ?? f.id ?? '')].map(cell).join(',')];
  let page = 1;
  let total = 0;
  do {
    const result = await getFormSubmissionsPage(c.env.DB, id, { page, limit: 200, lineAccountId: accountId!, search: c.req.query('q')?.trim().slice(0, 200) || undefined });
    total = result.total;
    for (const row of result.items) {
      const data = JSON.parse(row.data) as Record<string, unknown>;
      rows.push([row.id, row.created_at, ...fields.map(f => data[f.name ?? f.id ?? ''])].map(cell).join(','));
    }
    if (result.items.length === 0) break;
    page++;
  } while ((page - 1) * 200 < total);
  auditLog(c, 'form.submission.export', { id, kind: 'form' }, { lineAccountId: accountId! });
  return new Response('\uFEFF' + rows.join('\r\n') + '\r\n', { headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="form-responses.csv"',
    'Cache-Control': 'no-store',
  } });
};

export const get__api_forms_id_submissions_6 = async (c: Context<Env, "/api/forms/:id/submissions">) => {
  const id = c.req.param('id');
  if (!await canUseFormFromAccount(c, id, c.req.query('account_id'))) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  const form = await getFormById(c.env.DB, id);
  if (!form) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  let period: ReturnType<typeof reportPeriod>;
  try { period = reportPeriod({from:c.req.query('from'),to:c.req.query('to'),period:c.req.query('period') as ReportPeriodInput['period']}); }
  catch { return c.json({success:false,error:'期間は正しい日付（YYYY-MM-DD）、または this_month・last_month・all で指定してください'},400); }
  const hasPagination = c.req.query('page') !== undefined || c.req.query('limit') !== undefined;
  if (!hasPagination) {
    // SDKなど既存利用先との互換性を保つ。管理画面だけが明示的にページ分けを要求する。
    // 大きいフォームで重い応答になるため上限を置く。page/limit 付きへ移行すること。
    /*
     * **切るのは `getFormSubmissions` の SQL ひとつだけ。**ここで重ねて
     * `slice` すると、DB 側の天井を上げても口が黙って切り直してしまい、
     * 「名乗りと実際がずれているのに気づけない」という #722 の形がそのまま
     * 残る（実際、逆変異で確かめた: DB 側を 500 にしても slice があると
     * 試験が緑のままだった）。数も切る場所も1か所にする。
     */
    const submissions = await getFormSubmissions(c.env.DB, id, NON_PAGINATED_SUBMISSIONS_MAX, {...period,lineAccountId:c.req.query('account_id')});
    // Header 値は ASCII のみ。日本語の案内は PR と票に残す。
    // 数は直書きしない。名乗りと実際がずれると、取り落としに気づけない。
    c.header(
      'Warning',
      `299 - "non-paginated submissions are limited to ${NON_PAGINATED_SUBMISSIONS_MAX} rows; use page/limit"`,
    );
    const postActions = await describePostActionsForSubmissions(c.env.DB, submissions, form);
    return c.json({
      success: true,
      data: await Promise.all(submissions.map(async row => ({ ...serializeSubmission(row, postActions.get(row.id)), data: await hydrateDocumentAnswers(c.env.DB, JSON.parse(row.data), c.get('staff')?.role, row.id) }))),
    });
  }
  const page = listPage(c.req.query('page'));
  const limit = listLimit(c.req.query('limit'), 20);
  // N-171/N-179: 一覧・件数・CSV が同じ検索条件になるよう、検索語をページング前に渡す。
  const search = (c.req.query('q') ?? '').trim().slice(0, 200) || undefined;
  const [submissions, summary] = await Promise.all([
    getFormSubmissionsPage(c.env.DB, id, { ...period, page, limit, lineAccountId: c.req.query('account_id')!, search }),
    getFormSubmissionAnalytics(
      c.env.DB,
      id,
      c.req.query('account_id')!,
      dateFieldsOfForm(form),
      ratingFieldsOfForm(form),
      period,
    ),
  ]);
  // N-168: 後処理の未完を運用者へ見せる。予約(claim)の工程記録と
  // 「あるべき工程」を見比べた結果を各回答へ載せる。
  const postActions = await describePostActionsForSubmissions(c.env.DB, submissions.items, form);
  return c.json({
    success: true,
    data: {
      items: await Promise.all(submissions.items.map(async row => ({ ...serializeSubmission(row, postActions.get(row.id)), data: await hydrateDocumentAnswers(c.env.DB, JSON.parse(row.data), c.get('staff')?.role, row.id) }))),
      total: submissions.total,
      page: submissions.page,
      limit: submissions.limit,
      summary,
      period,
    },
  });
};

export const get__api_forms_id_submissions_submissionId_7 = async (c: Context<Env, "/api/forms/:id/submissions/:submissionId">) => {
  const formId = c.req.param('id');
  if (!await canUseFormFromAccount(c, formId, c.req.query('account_id'))) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  const form = await getFormById(c.env.DB, formId);
  const submission = await getFormSubmissionById(c.env.DB, c.req.param('submissionId'));
  if (!form || !submission || submission.form_id !== formId || submission.is_test) {
    return c.json({ success: false, error: '回答が見つかりません' }, 404);
  }
  const actions = await describePostActionsForSubmissions(c.env.DB, [submission], form);
  return c.json({ success: true, data: { ...serializeSubmission(submission, actions.get(submission.id)), data: await hydrateDocumentAnswers(c.env.DB, JSON.parse(submission.data), c.get('staff')?.role, submission.id) } });
};

export const post__api_forms_id_submissions_submissionId_retry_effects_8 = async (c: Context<Env, "/api/forms/:id/submissions/:submissionId/retry-effects">) => {
  const formId = c.req.param('id');
  const submissionId = c.req.param('submissionId');
  const manageGate = await requireFormManage(c, await getFormAccountIds(c.env.DB, formId));
  if (manageGate) return manageGate;
  if (!await canUseFormFromAccount(c, formId, c.req.query('account_id'))) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  const form = await getFormById(c.env.DB, formId);
  if (!form) {
    return c.json({ success: false, error: 'Form not found' }, 404);
  }
  const submission = await getFormSubmissionById(c.env.DB, submissionId);
  if (!submission || submission.form_id !== formId || !submission.friend_id) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  if (await customerDeletionPending(c.env.DB, submission.friend_id, submissionId)) return c.json({ success: false, error: 'この回答は削除中です' }, 409);
  const claim = await getFormSubmitClaimBySubmissionId(c.env.DB, submissionId);
  if (!claim) {
    return c.json({
      success: false,
      error: 'この回答には後処理の記録がありません',
      code: 'no_post_action_record',
    }, 409);
  }
  if (claim.status === 'completed') {
    return c.json({
      success: true,
      data: {
        complete: true,
        pendingEffects: [],
        submission: serializeSubmission(submission, await describeSubmissionPostActions(submission, claim, form)),
      },
    });
  }

  const scope: FormSubmitClaimScope = {
    tenantId: claim.tenant_id,
    lineAccountId: claim.line_account_id,
    formId: claim.form_id,
    friendId: claim.friend_id,
    key: claim.idempotency_key,
  };
  const owner = crypto.randomUUID();
  // 生きている処理とは重ねない。failed・期限切れは即時、in_progress は
  // 止まっているものだけ横取りする(送信の再開と同じ判定)。
  const staleBefore = claim.status === 'failed' || formSubmitClaimExpired(claim)
    ? toJstString(new Date())
    : formSubmitClaimStaleBefore();
  const takeover = await takeoverFormSubmitClaim(
    c.env.DB,
    scope,
    owner,
    staleBefore,
    { owner: claim.owner, version: claim.version },
  );
  if (!takeover.taken) {
    return c.json({
      success: false,
      error: '別の処理が進行中です。少し待ってからやり直してください',
      code: 'retry_in_progress',
    }, 429);
  }
  const taken = (await getFormSubmitClaim(c.env.DB, scope))!;
  const steps = new Set(readFormSubmitClaimSteps(taken));
  const busyResponse = () => c.json({
    success: false,
    error: '別の処理が進行中です。少し待ってからやり直してください',
    code: 'retry_in_progress',
  }, 429);
  const claimHandle: FormSubmitClaimHandle = {
    done: (step) => steps.has(step),
    checkpoint: async (step) => {
      const ok = await appendFormSubmitClaimStep(c.env.DB, scope, owner, step, taken.version);
      if (!ok) throw new ClaimOwnershipLost(busyResponse());
      steps.add(step);
    },
    readLayoutStats: async () => {
      const claimRow = await getFormSubmitClaim(c.env.DB, scope);
      return claimRow ? readFormSubmitClaimEffectStats(claimRow) : {};
    },
    recordLayoutEffect: async (effectId, merged) => {
      const keptStats = await saveFormSubmitClaimEffectStats(
        c.env.DB, scope, owner, taken.version, `layout:${effectId}`, merged,
      );
      if (!keptStats) throw new ClaimOwnershipLost(busyResponse());
      const ok = await appendFormSubmitClaimStep(
        c.env.DB, scope, owner, `layout:${effectId}`, taken.version,
      );
      if (!ok) throw new ClaimOwnershipLost(busyResponse());
      steps.add(`layout:${effectId}`);
    },
    settle: async (required) => {
      const missing = required.filter((step) => !steps.has(step));
      try {
        if (missing.length === 0) {
          await completeFormSubmitClaim(c.env.DB, scope, owner, taken.version);
        } else {
          await failFormSubmitClaim(c.env.DB, scope, owner, taken.version);
        }
      } catch (error) {
        logger.error("forms.forms_id_submissions_submission_id_retry_effects_post_failed");
      }
      return missing;
    },
  };

  // 再実行は回答が作られた当時の版の定義で行う。版が無い古い回答は
  // 公開中の定義を使う。
  const version = submission.form_version_id
    ? await getFormVersionContent(c.env.DB, submission.form_version_id)
    : null;
  const config = version ?? form;
  const layout = config.layout ? parseLayout(config.layout) : null;
  const storedData = JSON.parse(submission.data || '{}') as Record<string, unknown>;
  const answers = { ...storedData };
  delete answers._webhookResult;
  const friend = await getFriendById(c.env.DB, submission.friend_id);
  const lineRetryKey = (step: string) =>
    createBroadcastRetryKey('form-submit', submissionId, step);

  try {
    let webhookOutcome: { passed: boolean; data: unknown } | null = null;
    if (config.on_submit_webhook_url) {
      if (claimHandle.done('webhook')) {
        // 呼び直さず、残した結果を使う(送信の再開と同じ)。
        try {
          webhookOutcome = taken.webhook
            ? JSON.parse(taken.webhook) as { passed: boolean; data: unknown }
            : null;
        } catch {
          webhookOutcome = null;
        }
        if (!webhookOutcome || typeof webhookOutcome.passed !== 'boolean') {
          const outbox = await getFormSubmitOutbox(c.env.DB, scope, 'webhook');
          const delivered = readFormSubmitOutboxPayload(outbox?.payload ?? null);
          if (delivered) webhookOutcome = delivered;
        }
      }
      if (!webhookOutcome || typeof webhookOutcome.passed !== 'boolean') {
        // 記録が無い・壊れているときだけ、同じ event id で呼び直す。
        const webhookEventId = await createBroadcastRetryKey(
          'form-submit', 'webhook',
          scope.tenantId, scope.lineAccountId, formId, scope.friendId, scope.key,
        );
        const outbox = await ensureFormSubmitOutboxEvent(c.env.DB, scope, 'webhook', webhookEventId);
        const delivered = readFormSubmitOutboxPayload(outbox.payload);
        if (outbox.status === 'delivered' && delivered) {
          webhookOutcome = delivered;
        } else {
          const called = await callFormWebhook(config, answers, webhookEventId);
          await markFormSubmitOutboxDelivered(c.env.DB, scope, 'webhook', webhookEventId, {
            passed: called.passed, data: called.data,
          });
          webhookOutcome = { passed: called.passed, data: called.data };
        }
        if (!claimHandle.done('webhook')) {
          const kept = await saveFormSubmitClaimWebhook(
            c.env.DB, scope, owner, webhookOutcome, taken.version,
          );
          if (!kept) throw new ClaimOwnershipLost(busyResponse());
          steps.add('webhook');
        }
      }
    }
    const webhookData = publicFormWebhookData(webhookOutcome?.data);
    if (config.on_submit_webhook_url && webhookOutcome && !webhookOutcome.passed) {
      // 連携に弾かれた回答。残った工程(失敗通知・記録の締め)だけを補完する。
      const needsFailMessage = Boolean(config.on_submit_webhook_fail_message)
        && Boolean(friend?.line_user_id);
      if (needsFailMessage && !claimHandle.done('fail_message')) {
        try {
          const accessToken = await resolveFriendAccessToken(
            c.env.DB,
            friend!,
            c.env.LINE_CHANNEL_ACCESS_TOKEN,
            'forms.webhook-failure-send',
          );
          await pushViaHarnessProxy(
            new URL(c.req.url).origin,
            accessToken,
            friend!.line_user_id!,
            [{ type: 'text', text: config.on_submit_webhook_fail_message! }],
            await lineRetryKey('fail-message'),
            (request) => dispatchLineProxyLocally(request, c.env, optionalExecutionCtx(c)),
          );
          await claimHandle.checkpoint('fail_message');
        } catch (error) {
          if (error instanceof ClaimOwnershipLost) throw error;
          // 届かなくても残りの記録へ進む。未完のまま残して次の再実行に託す。
          logger.error("forms.forms_id_submissions_submission_id_retry_effects_post_failed");
        }
      }
      // 回答行はある(この口は回答idから入る)。記録だけ揃える。
      if (!claimHandle.done('answer')) await claimHandle.checkpoint('answer');
      if (!claimHandle.done('submit_count')) {
        await resyncFormSubmitCount(c.env.DB, formId);
        await claimHandle.checkpoint('submit_count');
      }
      // 弾かれた回答の data に結果を残す(一覧・詳細が読むため)。
      if (!('_webhookResult' in storedData)) {
        await c.env.DB
          .prepare(`UPDATE form_submissions SET data = ? WHERE id = ?`)
          .bind(JSON.stringify({ ...answers, _webhookResult: webhookOutcome.data }), submissionId)
          .run();
      }
      if (!claimHandle.done('destination_status')) {
        let recorded = false;
        try {
          const status = await updateFormSubmissionDestinationWriteResult(
            c.env.DB, submissionId, { attempted: 0, succeeded: 0, failed: 0 },
          );
          submission.destination_write_status = status;
          submission.destination_write_attempted = 0;
          submission.destination_write_succeeded = 0;
          submission.destination_write_failed = 0;
          recorded = true;
        } catch (error) {
          logger.error("forms.forms_id_submissions_submission_id_retry_effects_post_failed");
        }
        if (recorded) await claimHandle.checkpoint('destination_status');
      }
      const missing = await claimHandle.settle([
        'webhook',
        ...(needsFailMessage ? ['fail_message'] : []),
        'answer',
        'submit_count',
        'destination_status',
      ]);
      const postActions = await describeSubmissionPostActions(
        submission,
        await getFormSubmitClaim(c.env.DB, scope),
        config,
      );
      return c.json({
        success: true,
        data: {
          complete: missing.length === 0,
          pendingEffects: missing,
          submission: serializeSubmission(submission, postActions),
        },
        retryable: missing.length > 0,
      }, missing.length > 0 ? 202 : 200);
    }

    // 通常経路。回答行・定員枠・受付数は送信時に確保済みなので、記録が
    // 欠けているときだけ記録を揃える(枠や回答行の二重消費はしない)。
    if (!claimHandle.done('answer')) await claimHandle.checkpoint('answer');
    if (!claimHandle.done('capacity')) await claimHandle.checkpoint('capacity');
    if (!claimHandle.done('submit_count')) {
      await resyncFormSubmitCount(c.env.DB, formId);
      await claimHandle.checkpoint('submit_count');
    }
    const pending = await runFormPostEffects({
      db: c.env.DB,
      formId,
      form: config,
      expectedLineAccountId: scope.lineAccountId,
      layout,
      friendId: submission.friend_id,
      submissionData: answers,
      submission,
      webhookData,
      trackedLinkId: null,
      claim: claimHandle,
      lineRetryKey,
      origin: new URL(c.req.url).origin,
      defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
      workerUrl: c.env.WORKER_URL,
      env: c.env,
      executionCtx: optionalExecutionCtx(c),
    });
    const postActions = await describeSubmissionPostActions(
      submission,
      await getFormSubmitClaim(c.env.DB, scope),
      config,
    );
    return c.json({
      success: true,
      data: {
        complete: pending.length === 0,
        pendingEffects: pending,
        submission: serializeSubmission(submission, postActions),
      },
      retryable: pending.length > 0,
    }, pending.length > 0 ? 202 : 200);
  } catch (err) {
    if (err instanceof ClaimOwnershipLost) return err.response;
    await failFormSubmitClaim(c.env.DB, scope, owner, taken.version).catch(() => {});
    throw err;
  }
};
