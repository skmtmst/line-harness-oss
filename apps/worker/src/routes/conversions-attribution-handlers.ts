import { logger } from '@line-crm/shared/server';
import { inputError } from '../lib/input-errors.js';
import { fail } from '../lib/fail.js';
import { decideConversionApproval, syncAffiliateConversionMileage, getAttributionDecisionView } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { auditLog } from '../lib/audit-log.js';
import { readApprovalDecision, notifyApprovalOnce, runApprovedConversionOfferActions, offerActionFailureMessage, BULK_APPROVAL_MAX_ITEMS, BulkApprovalItemResult, isEventVisibleToStaff, bulkItemAccountId } from './conversions-definition.js';
import type { Context } from 'hono';

export const get__api_conversions_events_id_attribution_1 = async (c: Context<Env, "/api/conversions/events/:id/attribution">) => {
  try {
    const view = await getAttributionDecisionView(c.env.DB, c.req.param('id'));
    if (!view) {
      return c.json({ success: false, error: 'この成果の付け方の記録がありません' }, 404);
    }
    return c.json({
      success: true,
      data: {
        conversionEventId: view.conversionEventId,
        affiliateId: view.affiliateId,
        refCode: view.refCode,
        offerId: view.offerId,
        offerVersionId: view.offerVersionId,
        reason: view.reason,
        windowDays: view.windowDays,
        candidates: view.candidates.map((candidate) => ({
          affiliateId: candidate.affiliateId,
          affiliateName: candidate.affiliateName,
          refCode: candidate.refCode,
          touchedAt: candidate.touchedAt,
          offerId: candidate.offerId,
          offerName: candidate.offerName,
          chosen: candidate.chosen,
          skipReason: candidate.skipReason,
          windowDays: candidate.windowDays,
        })),
        createdAt: view.createdAt,
      },
    });
  } catch (err) {
    throw err;
  }
};

export const patch__api_conversions_events_id_approval_2 = async (c: Context<Env, "/api/conversions/events/:id/approval">) => {
  // 保存されていない変更を監査へ載せないよう、更新の成功確定後に記録する。
  // 書いていたため、400/404の失敗も「更新」の記録に混ざっていた。
  try {
    const body = await c.req
      .json<{ status?: unknown; expectedStatus?: unknown }>()
      .catch(() => ({}) as { status?: unknown; expectedStatus?: unknown });

    const parsed = readApprovalDecision(body);
    if (!parsed.ok) {
      return inputError(c, { success: false, error: parsed.error }, 400, ["status","expectedStatus"]);
    }

    const decided = await decideConversionApproval(
      c.env.DB,
      c.req.param('id'),
      parsed.status,
      parsed.expectedStatus,
    );
    if (decided.outcome === 'not_found') {
      // 存在しない成果とアフィリエイト帰属のない成果は、どちらも404にする。
      return fail(c, 404, 'ATTRIBUTED_CONVERSION_EVENT_NOT_FOUND');
    }
    if (decided.outcome === 'conflict') {
      // ほかの人が先に別の判断をしている。上書きせず409で返し、画面は
      // 読み直しを促す。DBには何も残さない。
      return c.json(
        {
          success: false,
          code: 'approval_conflict',
          error: 'ほかの人が先に判断しました。一覧を読み直して確認してください。',
          data: { id: c.req.param('id'), currentStatus: decided.currentStatus },
        },
        409,
      );
    }
    if (decided.outcome === 'unbillable') {
      // 記録した当時の報酬額を確認できない成果は、承認すると今の額で
      // 固まってしまうため承認しない。状態は変えず、監査にも残さない。
      // 422 を返す: fetchApi は本文だけを文言として画面へ渡す。
      return inputError(c, {
          success: false,
          code: 'approval_unbillable',
          error: '記録した当時の報酬額を確認できないため、承認できませんでした。対応方法が決まるまでこのままにしてください。',
          data: { id: c.req.param('id'), currentStatus: decided.currentStatus },
        }, 422, ["status","expectedStatus"]);
    }
    auditLog(c, 'conversion.approval.update', { kind: 'conversion_event', id: c.req.param('id') });

    // 承認更新後の台帳書込失敗を回復できるよう、already_set でも再試行可能なマイル反映を行う。
    await syncAffiliateConversionMileage(
      c.env.DB,
      c.req.param('id'),
      parsed.status,
    );

    // 参加者向けの通知は承認時だけ行い、否認時には送らない。
    // Best-effort で承認を巻き添えにしない。案件動作の結果には左右されない
    // （承認そのものは成立している）。
    // m22u : 初回（updated）・再試行（already_set）のどちらでも、欠けた
    // 通知は1回だけ送る。同じ承認世代の二重送信は送信記録で止める。
    if (parsed.status === 'approved') {
      await notifyApprovalOnce(c.env.DB, c.env, c.req.param('id'));
    }

    // 承認確定で案件の動作（タグ付与・シナリオ開始）を実行する。
    // already_set の再送でも走らせて未完の修復にする。未完が残ったら
    // 成功とは返さない — 運用者は再送するか案件の設定を直す。
    // 422 を返す: fetchApi は BODY_MESSAGE_STATUSES の本文だけを文言として
    // 画面へ渡す。500 だと「API error: 500」に潰れて理由が届かない。
    if (parsed.status === 'approved') {
      const actionFailures = await runApprovedConversionOfferActions(c.env.DB, c.req.param('id'));
      if (actionFailures.length > 0) {
        return inputError(c, {
            success: false,
            code: 'offer_actions_incomplete',
            error: offerActionFailureMessage(actionFailures),
            data: {
              id: c.req.param('id'),
              approvalStatus: 'approved',
              actionFailures,
            },
          }, 422, []);
      }
    }

    if (decided.outcome === 'already_set') {
      // 同じ状態へのクリックはエラーを見せず、冪等な200として返す。
      return c.json({
        success: true,
        data: { id: c.req.param('id'), approvalStatus: parsed.status, alreadySet: true },
      });
    }

    return c.json({ success: true, data: { id: c.req.param('id'), approvalStatus: parsed.status } });
  } catch (err) {
    throw err;
  }
};

export const post__api_conversions_approvals_bulk_3 = async (c: Context<Env, "/api/conversions/approvals/bulk">) => {
  try {
    const body = await c.req
      .json<{ items?: unknown }>()
      .catch(() => ({}) as { items?: unknown });
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > BULK_APPROVAL_MAX_ITEMS) {
      return inputError(c, { success: false, error: `items must be 1-${BULK_APPROVAL_MAX_ITEMS} approval decisions` }, 400, ["items"]);
    }
    const result: BulkApprovalItemResult = { succeeded: [], conflicted: [], denied: [], failed: [] };
    // m22u : 入口で有効と判定されたアカウントの集合。対象ごとに機能オフを
    // 確認し、オフなら1件ずつ失敗として返す（A指定でB対象を通さない）。
    const enabledAccounts = c.get('staff')?.featureEnabledLineAccountIds;
    for (const raw of body.items) {
      const item = (raw ?? {}) as { id?: unknown; status?: unknown; expectedStatus?: unknown };
      const itemId = typeof item.id === 'string' ? item.id : '';
      try {
        if (!itemId) {
          result.failed.push({ id: '', error: 'id is required' });
          continue;
        }
        const parsed = readApprovalDecision(item);
        if (!parsed.ok) {
          result.failed.push({ id: itemId, error: parsed.error });
          continue;
        }
        const visible = await isEventVisibleToStaff(c.env.DB, c.get('staff'), itemId);
        if (!visible) {
          result.denied.push(itemId);
          continue;
        }
        if (enabledAccounts !== undefined) {
          const accountId = await bulkItemAccountId(c.env.DB, itemId);
          if (accountId === null || !enabledAccounts.includes(accountId)) {
            result.failed.push({ id: itemId, error: 'このLINEアカウントでは成果の承認機能がオフになっています' });
            continue;
          }
        }
        const decided = await decideConversionApproval(c.env.DB, itemId, parsed.status, parsed.expectedStatus);
        if (decided.outcome === 'conflict') {
          result.conflicted.push({ id: itemId, currentStatus: decided.currentStatus });
          continue;
        }
        if (decided.outcome === 'not_found') {
          result.failed.push({ id: itemId, error: 'Attributed conversion event not found' });
          continue;
        }
        if (decided.outcome === 'unbillable') {
          // 記録した当時の報酬額を確認できない成果は承認しない。
          // 成功には入れず、失敗として分けて返す。
          result.failed.push({ id: itemId, error: '記録した当時の報酬額を確認できないため承認できません' });
          continue;
        }
        auditLog(c, 'conversion.approval.update', { kind: 'conversion_event', id: itemId });
        await syncAffiliateConversionMileage(c.env.DB, itemId, parsed.status);
        // m22u : 初回・再試行のどちらでも、欠けた通知は1回だけ送る。
        if (parsed.status === 'approved') {
          await notifyApprovalOnce(c.env.DB, c.env, itemId);
        }
        // 単体と同じく、承認確定で案件の動作を実行する。未完は
        // succeeded へ入れず failed に分け、全成功とは表示させない。
        if (parsed.status === 'approved') {
          try {
            const actionFailures = await runApprovedConversionOfferActions(c.env.DB, itemId);
            if (actionFailures.length > 0) {
              result.failed.push({ id: itemId, error: offerActionFailureMessage(actionFailures) });
              continue;
            }
          } catch (err) {
            logger.error("conversions.conversions_approvals_bulk_post_failed");
            result.failed.push({ id: itemId, error: '案件の動作を実行できませんでした' });
            continue;
          }
        }
        result.succeeded.push(itemId);
      } catch (err) {
        // m22u : 途中の失敗で全体を500にしない。処理済み・失敗の一覧を
        // 必ず返し、一部だけ承認済みのまま黙って止まらないようにする。
        logger.error("conversions.conversions_approvals_bulk_post_failed");
        result.failed.push({ id: itemId, error: '処理できませんでした。もう一度お試しください' });
      }
    }
    return c.json({ success: true, data: result });
  } catch (err) {
    throw err;
  }
};
