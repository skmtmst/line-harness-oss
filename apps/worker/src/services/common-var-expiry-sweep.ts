// Q: 共通情報の期限の14日前と3日前に運用者へ知らせる。
//
// 送る口は運用者通知ルール（common_var_expiry）なので、届け先は
// 管理画面の通知設定で決まる。同じ知らせを繰り返さないよう、
// 出した側を expiry_notice_14_at / expiry_notice_3_at に記録する。
// 印を先に打つのは、同時に動いた別の sweep が同じ知らせを
// 二重に出さないための請求（claim）である。

import {
  isCommonVarsEnabled,
  listCommonVarExpiryCandidates,
  markCommonVarExpiryNotice,
  type CommonVarExpiryCandidate,
} from '@line-crm/db';
import { dispatchOperatorEvent } from './operator-notification-dispatch.js';
import type { sendOperationEmail } from './operation-notifications.js';

const THREE_DAYS_MS = 3 * 24 * 3600_000;

export interface CommonVarExpirySweepResult {
  notified: number;
  candidates: number;
  errors: number;
}

export async function sweepCommonVarExpiryNotices(
  db: D1Database,
  env: Parameters<typeof sendOperationEmail>[0],
  now: Date = new Date(),
): Promise<CommonVarExpirySweepResult> {
  const nowIso = now.toISOString();
  const rawCandidates = await listCommonVarExpiryCandidates(db, nowIso);
  // 機能設定で共通情報を止めているアカウントには期限の知らせを出さない。
  const candidates: CommonVarExpiryCandidate[] = [];
  for (const candidate of rawCandidates) {
    if (await isCommonVarsEnabled(db, candidate.line_account_id)) {
      candidates.push(candidate);
    }
  }
  const result: CommonVarExpirySweepResult = {
    notified: 0,
    candidates: candidates.length,
    errors: 0,
  };

  for (const candidate of candidates) {
    try {
      const notified = await notifyOnce(db, env, candidate, now);
      result.notified += notified;
    } catch (error) {
      result.errors += 1;
      console.error(
        JSON.stringify({
          event: 'common_var_expiry_notice_error',
          varId: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return result;
}

async function notifyOnce(
  db: D1Database,
  env: Parameters<typeof sendOperationEmail>[0],
  candidate: CommonVarExpiryCandidate,
  now: Date,
): Promise<number> {
  const remainingMs = Date.parse(candidate.valid_until) - now.getTime();
  // 3日を切っていれば3日前の知らせ。3日前の知らせを出した時点で14日前の
  // 知らせはもう間に合わないので、未送信なら出した扱いにして二重送信を止める。
  const kind = remainingMs <= THREE_DAYS_MS ? '3d' : '14d';
  const alreadySent = kind === '3d' ? candidate.expiry_notice_3_at : candidate.expiry_notice_14_at;
  if (alreadySent !== null) return 0;

  const claimed = await markCommonVarExpiryNotice(db, candidate.id, kind, now.toISOString());
  if (!claimed) return 0;
  if (kind === '3d' && candidate.expiry_notice_14_at === null) {
    await markCommonVarExpiryNotice(db, candidate.id, '14d', now.toISOString());
  }

  const daysLeft = Math.max(0, Math.ceil(remainingMs / (24 * 3600_000)));
  await dispatchOperatorEvent(db, env, {
    lineAccountId: candidate.line_account_id,
    eventType: 'common_var_expiry',
    sourceEventId: `common_var_expiry:${candidate.id}:${kind}:${candidate.valid_until}`,
    message: `共通情報「${candidate.name}」（差し込み名: {${candidate.var_key}}）の期限が${daysLeft}日後に切れます。期限を延ばすか、代替値を決めてください`,
    executionMode: 'automatic',
  });
  return 1;
}
