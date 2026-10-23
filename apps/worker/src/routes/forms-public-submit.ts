import { logger } from '@line-crm/shared/server';
import { canonicalizeIdempotencyInput } from './form-idempotency.js';
import { callFormWebhook, publicFormWebhookData } from '../features/forms/form-webhook/index.js';
import { inputError, validatedInputBody } from '../lib/input-errors.js';
import { validateDocumentAnswers, attachDocumentAnswers, documentIds } from '../features/forms/form-documents/index.js';
import { applyAccountAllergyOptions } from '../services/allergy-options.js';

import { getFormById, type FormSubmitClaimScope, formBelongsToLineAccount, getFormSubmissionById, insertFormSubmissionRecord, resyncFormSubmitCount, claimFormCapacitySlot, releaseFormCapacityClaims, createFormSubmitClaim, getFormSubmitClaim, takeoverFormSubmitClaim, readFormSubmitClaimSteps, appendFormSubmitClaimStep, saveFormSubmitClaimWebhook, completeFormSubmitClaim, failFormSubmitClaim, ensureFormSubmitOutboxEvent, getFormSubmitOutbox, markFormSubmitOutboxDelivered, readFormSubmitOutboxPayload, readFormSubmitClaimEffectStats, saveFormSubmitClaimEffectStats, findUnfinishedFormSubmitClaimByHash, getFormVersionContent, updateFormSubmissionDestinationWriteResult, getFriendByLineUserIdForAccount, getLineAccountById, toJstString } from '@line-crm/db';
import type { Form as DbForm, FormSubmission as DbFormSubmission, FormDestinationWriteResult } from '@line-crm/db';
import { recordConversionSourceEvent } from '@line-crm/db';

import { verifyCallerLineIdentity } from '../services/liff-auth.js';
import { pushViaHarnessProxy } from '../services/line-proxy-send.js';
import { dispatchLineProxyLocally } from '../services/local-line-proxy.js';


import type { Env } from '../worker-env.js';
import { createBroadcastRetryKey } from '../features/broadcasts/broadcast-retry-key/index.js';
import { fireOutgoingWebhooks } from '../services/event-bus.js';
import { applyActionScoreEvent } from '../services/action-score-events.js';
import { dispatchOperatorEvent } from '../services/operator-notification-dispatch.js';

import { checkFormGates, collectCapacitySlots } from '../features/forms/form-layout-effects/index.js';
import { collectInputs, parseLayout, type FormLayout } from '@line-crm/shared';

import { stoppedPublicFormResponse, FORM_IDEMPOTENCY_KEY_PATTERN, readFormTestToken, verifyFormTestToken, FORM_SUBMIT_DATA_MAX_FIELDS, FORM_SUBMIT_DATA_MAX_BYTES, FORM_SUBMIT_TRACKED_LINK_MAX_LENGTH, serializeSubmission, hashIdempotentSubmission, formSubmitClaimExpired, serializeIdempotentReplay, FORM_IDEMPOTENCY_TTL_MS, formSubmitClaimStaleBefore, FormSubmitClaimHandle, ClaimOwnershipLost, resolveFriendAccessToken, optionalExecutionCtx, runFormPostEffects } from './forms-definition.js';
import type { Context } from 'hono';

export const post__api_forms_id_submit_1 = async (c: Context<Env, "/api/forms/:id/submit">) => {
  const stopped = await stoppedPublicFormResponse(c, c.req.param('id'));
  if (stopped) return stopped;
  try {
    const formId = c.req.param('id');
    // 送信には Idempotency-Key(UUID)が必須。キーなしの連打・再送は
    // 二重回答になるため受け付けない(イベント予約と同じ流儀)。
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim() || null;
    if (!idempotencyKey) {
      return inputError(c, { success: false, error: 'idempotency_key_required' }, 400, []);
    }
    if (!FORM_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return inputError(c, { success: false, error: 'Idempotency-Key must be a UUID' }, 400, []);
    }
    // 本文は手前の inputJsonBoundary が読んでオブジェクトだと確かめている。
    // ここで読み直すと同じ本文を二度読むことになるので、検査済みをそのまま使う。
    // この口を通らない組み合わせのときだけ、従来どおり読んで形を確かめる。
    let body: { data?: unknown; trackedLinkId?: unknown; testToken?: unknown };
    const validated = validatedInputBody(c);
    if (validated) {
      body = validated;
    } else {
      try {
        body = await c.req.json();
      } catch {
        return inputError(c, { success: false, error: 'リクエストの形式が正しくありません' }, 400, []);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return inputError(c, { success: false, error: 'リクエストの形式が正しくありません' }, 400, []);
      }
    }
    // P（試し回答）：試し合言葉はヘッダ・クエリ・本文のどこからでも読む。
    // 正しければ下書きを読む（公開版が無くても・受付停止でも試せる）。
    // 合言葉が違うときは本物として扱わず、試しだと分かる文で断る。
    const presentedTestToken = readFormTestToken(c)
      ?? (typeof body.testToken === 'string' && body.testToken.trim() ? body.testToken.trim() : null);
    let testDraft: DbForm | null = null;
    if (presentedTestToken) {
      if (!await verifyFormTestToken(c.env.DB, formId, presentedTestToken)) {
        return c.json({ success: false, error: '試し合言葉が無効です。管理画面から取り直してください' }, 403);
      }
      testDraft = await getFormById(c.env.DB, formId);
      if (!testDraft) {
        return c.json({ success: false, error: 'Form not found' }, 404);
      }
    }
    let form: DbForm;
    if (testDraft) {
      form = testDraft;
    } else {
      const published = await getFormById(c.env.DB, formId, { published: true });
      if (!published) {
        return c.json({ success: false, error: 'Form not found' }, 404);
      }
      if (!published.is_active) {
        return inputError(c, { success: false, error: 'This form is no longer accepting responses' }, 400, []);
      }
      form = published;
    }
    // data と trackedLinkId は実行時に形と大きさを見る。形の違う値は
    // 後の処理で落ちる前に 400 で断る。
    if (body.data !== undefined
      && (body.data === null || typeof body.data !== 'object' || Array.isArray(body.data))) {
      return inputError(c, { success: false, error: '回答の形式が正しくありません' }, 400, ["data"]);
    }
    const submissionData = (body.data ?? {}) as Record<string, unknown>;
    if (Object.keys(submissionData).length > FORM_SUBMIT_DATA_MAX_FIELDS
      || JSON.stringify(submissionData).length > FORM_SUBMIT_DATA_MAX_BYTES) {
      return inputError(c, { success: false, error: '回答が大きすぎます' }, 400, ["data"]);
    }
    if (body.trackedLinkId !== undefined
      && (typeof body.trackedLinkId !== 'string'
        || body.trackedLinkId.length > FORM_SUBMIT_TRACKED_LINK_MAX_LENGTH)) {
      return inputError(c, { success: false, error: 'リンクの指定が正しくありません' }, 400, ["trackedLinkId"]);
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

    // P（試し回答）：試し合言葉が正しければ、下書きへの試し回答として保存する。
    // 集計に入れず、定員の確保・件数の更新・Webhook・タグ・シナリオ・リマインダ・
    // マイル・通知・自動化・計測をいっさい動かさない。入力の形と回答期限は
    // 本物と同じに見る。
    if (testDraft) {
      delete submissionData._webhookVerified;
      delete submissionData._skipWebhook;
      const draftLayout: FormLayout | null = testDraft.layout ? parseLayout(testDraft.layout) : null;
      let testRejected: string | null = null;
      if (draftLayout) {
        testRejected = await checkFormGates({
          db: c.env.DB,
          formId,
          layout: draftLayout,
          friendId,
          submitCount: 0,
          answers: submissionData,
          isTest: true,
        });
      } else {
        const fields = JSON.parse(testDraft.fields || '[]') as Array<{
          name: string;
          label: string;
          type: string;
          required?: boolean;
        }>;
        for (const field of fields) {
          if (field.required) {
            const val = submissionData[field.name];
            if (val === undefined || val === null || val === '') {
              testRejected = `${field.label} は必須項目です`;
              break;
            }
          }
        }
      }
      if (testRejected) {
        return inputError(c, { success: false, error: testRejected }, 400, []);
      }
      const testDocumentsError = await validateDocumentAnswers(c.env.DB, draftLayout, submissionData, { accountId: identity.lineAccountId, formId, friendId, versionId: testDraft.current_published_version_id ?? null });
      if (testDocumentsError) return c.json({ success: false, error: testDocumentsError }, 400);
      const testSubmission = await insertFormSubmissionRecord(c.env.DB, {
        id: crypto.randomUUID(),
        formId,
        formVersionId: testDraft.current_published_version_id ?? null,
        friendId,
        data: JSON.stringify(submissionData),
        isTest: true,
        fileIds: documentIds(submissionData, draftLayout),
      });
      await attachDocumentAnswers(c.env.DB, submissionData, testSubmission.id, friendId, draftLayout);
      return c.json(
        { success: true, data: { ...serializeSubmission(testSubmission), isTest: true } },
        201,
      );
    }

    // キーあり送信の照合材料。読み取りだけに使い、予約の書き込みは判定の後。
    let peekScope: FormSubmitClaimScope | null = null;
    let peekHash: string | null = null;
    let resumeSavedAnswer = false;
    let resumeSubmissionId: string | null = null;
    if (idempotencyKey) {
      const hashSource: Record<string, unknown> = { ...submissionData };
      delete hashSource._webhookVerified;
      delete hashSource._skipWebhook;
      for (const block of collectInputs(parseLayout(form.layout, form.fields)).filter(b => b.type === 'file')) {
        const value = hashSource[block.name];
        if (Array.isArray(value)) hashSource[block.name] = value.map(v => v && typeof v === 'object' && typeof v.fileId === 'string' ? { fileId: v.fileId } : v);
      }
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
      if (peeked && peeked.request_hash !== peekHash) {
        return c.json({success: false, error: 'Idempotency-Key was already used with a different request', code: 'idempotency_content_mismatch', retryable: false}, 409);
      }
      if (peeked && peeked.status !== 'completed' && !formSubmitClaimExpired(peeked)
        && peeked.request_hash === peekHash && peeked.submission_id) {
        const saved = await getFormSubmissionById(c.env.DB, peeked.submission_id);
        if (saved && saved.form_id === formId && saved.friend_id === friendId) {
          // 同じ保存済み回答の未完工程を補う。新しい回答の枠は取らない。
          if (saved.form_version_id) {
            const version = await getFormVersionContent(c.env.DB, saved.form_version_id);
            if (!version || version.form_id !== formId) throw new Error('saved_form_version_missing');
            const {id, form_id: _formId, ...snapshot} = version;
            form = {...form, ...snapshot, current_published_version_id: id};
          }
          resumeSavedAnswer = true;
          resumeSubmissionId = saved.id;
        }
      }
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
    const layout: FormLayout | null = form.layout ? await applyAccountAllergyOptions(c.env.DB, identity.lineAccountId!, parseLayout(form.layout)) : null;

    const documentsError = await validateDocumentAnswers(c.env.DB, layout, submissionData, { accountId: identity.lineAccountId, formId, friendId, versionId: form.current_published_version_id ?? null, submissionId: resumeSubmissionId });
    if (documentsError) return c.json({ success: false, error: documentsError }, 400);

    if (layout) {
      const rejected = await checkFormGates({
        db: c.env.DB,
        formId,
        layout,
        friendId,
        submitCount: form.submit_count ?? 0,
        answers: submissionData,
        resumeSavedAnswer,
      });
      if (rejected) {
        return inputError(c, { success: false, error: rejected }, 400, ["data"]);
      }
    } else if (!resumeSavedAnswer) {
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
            return inputError(c, { success: false, error: `${field.label} は必須項目です` }, 400, [`data.${field.name}`]);
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
            throw new Error('form_submit_claim_is_completed_without_an_answer_row');
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
        logger.error("forms.settle_claim_failed");
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
    // 工程記録の窓口。後処理の本体(runFormPostEffects)は送信と管理画面の
    // 再実行で共有するため、ここの予約操作を約束の形に包んで渡す。
    const claimHandle: FormSubmitClaimHandle | null = claimCtx ? {
      done: claimDone,
      checkpoint: async (step) => {
        const lost = await claimCheckpoint(step);
        if (lost) throw new ClaimOwnershipLost(lost);
      },
      readLayoutStats: async () => {
        const claimRow = await getFormSubmitClaim(c.env.DB, claimCtx!.scope);
        return claimRow ? readFormSubmitClaimEffectStats(claimRow) : {};
      },
      recordLayoutEffect: async (effectId, merged) => {
        const keptStats = await saveFormSubmitClaimEffectStats(
          c.env.DB,
          claimCtx!.scope,
          claimCtx!.owner,
          claimCtx!.version,
          `layout:${effectId}`,
          merged,
        );
        if (!keptStats) throw new ClaimOwnershipLost(claimBusyResponse());
        const lost = await claimCheckpoint(`layout:${effectId}`);
        if (lost) throw new ClaimOwnershipLost(lost);
      },
      settle: settleClaim,
    } : null;

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
              formVersionId: form.current_published_version_id,
              friendId,
              data,
              fileIds: documentIds(submissionData, layout),
            });
          } catch (error) {
            await failFormSubmitClaim(c.env.DB, ctx.scope, ctx.owner, ctx.version).catch(() => {});
            throw error;
          }
        }
        const lost = await claimCheckpoint('answer');
        if (lost) throw new ClaimOwnershipLost(lost);
      }
      await attachDocumentAnswers(c.env.DB, submissionData, ctx.submissionId, friendId, layout);
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

    // 全体上限・選択肢定員を原子的に確保する(N-167 / #751)。
    //
    // 上の checkFormGates は「数えてから比べる」だけの安い先読みで、
    // 比べたあと保存するまでの間に別の回答が割り込む隙間がある。ここが
    // 最終的な砦(正本)。枠ごとに条件付き INSERT 1本で決め、changes を
    // 見て勝った者だけを通す(claimFormCapacitySlot)。同時に複数の枠が
    // 要る回答(定員つきの選択肢を選びつつ全体上限もある等)は、1つでも
    // 取れなければ確保済みの分ごと取り消す。
    //
    // Webhook より前に置くのは、どうせ断る回答のために外部へ問い合わせを
    // 投げないため。工程(capacity)は一度きり: 再開時に二重に消費しない。
    const ensureCapacity = async (): Promise<string | null> => {
      if (!claimCtx || !layout) return null;
      if (claimDone('capacity') && await getFormSubmissionById(c.env.DB, claimCtx.submissionId)) return null;
      const slots = collectCapacitySlots(layout, submissionData);
      if (slots.length === 0) {
        const lost = await claimCheckpoint('capacity');
        if (lost) throw new ClaimOwnershipLost(lost);
        return null;
      }
      let rejectedMessage: string | null = null;
      for (const slot of slots) {
        const ok = await claimFormCapacitySlot(c.env.DB, formId, slot.key, claimCtx.submissionId, slot.limit, slot.choice);
        if (!ok) {
          rejectedMessage = slot.message;
          break;
        }
      }
      if (rejectedMessage !== null) {
        await releaseFormCapacityClaims(c.env.DB, formId, claimCtx.submissionId);
        return rejectedMessage;
      }
      const lost = await claimCheckpoint('capacity');
      if (lost) throw new ClaimOwnershipLost(lost);
      return null;
    };

    let submission: DbFormSubmission;
    let webhookData: Record<string, unknown> | null = null;
    // 配分結果の記録。キーありの再開時に記録済みなら上書きせず、集計値を残す。
    const updateDestinationWriteResult = async (result: FormDestinationWriteResult): Promise<void> => {
      if (claimCtx && claimDone('destination_status')) {
        const current = await getFormSubmissionById(c.env.DB, submission.id);
        if (current && ['succeeded','not_requested'].includes(current.destination_write_status)) return;
      }
      try {
        const status = await updateFormSubmissionDestinationWriteResult(c.env.DB, submission.id, result);
        submission.destination_write_status = status;
        submission.destination_write_attempted = result.attempted;
        submission.destination_write_succeeded = result.succeeded;
        submission.destination_write_failed = result.failed;
      } catch (error) {
        // 回答自体は保存済み。記録失敗を回答失敗へ見せず、再開時に残す。
        logger.error("forms.update_destination_write_result_failed");
        return;
      }
      if (claimCtx) {
        const lost = await claimCheckpoint('destination_status');
        if (lost) throw new ClaimOwnershipLost(lost);
      }
    };

    const capacityRejected = await ensureCapacity();
    if (capacityRejected) {
      if (claimCtx) {
        await failFormSubmitClaim(c.env.DB, claimCtx.scope, claimCtx.owner, claimCtx.version).catch(() => {});
      }
      return inputError(c, { success: false, error: capacityRejected }, 400, []);
    }

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
        webhookData = publicFormWebhookData(webhookOutcome);
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
              logger.error("forms.forms_id_submit_post_failed");
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
            webhookData: publicFormWebhookData(webhookOutcome),
          };
          if (pendingWebhook.length > 0) return incompleteResponse(rejectedData, pendingWebhook);
          return settleResponse(rejectedData, 201);
        }
      }

      // Save submission against the authenticated caller only.
      submission = await ensureAnswer(JSON.stringify(submissionData));
      await ensureSubmitCount();

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
      logger.error("forms.record_form_conversion_failed");
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
        // R150: 送信Webhookの購読対象としても発火する。回答の中身は
        // 個人情報を含むので送らず、識別子とフォーム名だけ渡す。
        fireOutgoingWebhooks(c.env.DB, 'form_submitted', {
          friendId,
          sourceKind: 'form',
          sourceEventId: submission.id,
          occurredAt: submission.created_at,
          eventData: { formId, formName: form.name, submissionId: submission.id },
        }, identity.lineAccountId),
        // 回答が入ったことを運用者へ知らせる。他の副作用と同じ扱いで、
        // 通知が落ちても回答は成立させる。発生元に回答IDを使うので、
        // 同じキーでの再送・再開で通知が二重に作られることはない。
        // 送り残しは回収口から拾う。
        dispatchOperatorEvent(c.env.DB, c.env, {
          lineAccountId: identity.lineAccountId,
          eventType: 'form_submitted',
          sourceEventId: submission.id,
          message: `フォーム「${form.name}」に回答がありました`,
          executionMode: 'automatic',
        }),
      ]).then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') logger.error("forms.forms_id_submit_post_failed");
        }
      }),
    );

    // 回答後の処理は工程つきで進める。終わった工程は記録で飛ばし、
    // 未完の工程だけを残す。管理画面からの再実行(N-168)も同じ道を通る。
    const pending = await runFormPostEffects({
      db: c.env.DB,
      formId,
      form,
      expectedLineAccountId: identity.lineAccountId,
      layout,
      friendId: friendId!,
      submissionData,
      submission,
      webhookData,
      trackedLinkId: trackedLinkId ?? null,
      claim: claimHandle,
      lineRetryKey,
      origin: new URL(c.req.url).origin,
      defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
      workerUrl: c.env.WORKER_URL,
      env: c.env,
      executionCtx,
    });
    if (pending.length > 0) {
      return incompleteResponse(serializeSubmission(submission), pending);
    }
    return settleResponse(serializeSubmission(submission), 201);
  } catch (err) {
    if (err instanceof ClaimOwnershipLost) return err.response;
    if (claimCtx) {
      await failFormSubmitClaim(c.env.DB, claimCtx.scope, claimCtx.owner, claimCtx.version).catch(() => {});
    }
    throw err;
  }
  } catch (err) {
    if (err instanceof Error && ['document_attachment_failed', 'document_already_submitted', 'document_attachment_conflict'].includes(err.message)) {
      return c.json({ success: false, code: 'document_attachment_failed', error: '書類を回答に付けられませんでした。書類をもう一度選んで、送信してください' }, 409);
    }
    throw err;
  }
};
