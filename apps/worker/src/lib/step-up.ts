import type { Context } from 'hono';
import type { Env } from '../index.js';
import { consumeStepUpGrant, getAdminSessionByTokenHash } from '@line-crm/db';
import { adminSessionTokenHashFromRequest, sha256Hex } from '../middleware/auth.js';

/**
 * 大事な操作の直前再確認（V：v6-26 §16・v6-30 §14・v6-33 §16）。
 *
 * 対象：鍵・トークンの操作、権限の変更、LINE の接続の変更、一斉配信の承認、
 * アカウントの停止・削除。二者承認など後続の高危険操作もここへ乗せる。
 *
 * 通し方は3段：
 * 1. いつもの端末・場所のセッションは、最後の再確認から10分以内ならそのまま通す
 *    （再確認の時刻は admin_sessions.step_up_at が持つ。ヘッダだけでは通さない）。
 * 2. 期限切れ・未確認のときは X-Step-Up-Token の1回限り grant を消費して通す
 *    （従来の確認ダイアログ→本操作のやり直し経路）。
 * 3. いつもと違う端末・場所（unfamiliar_at が立つ）のセッションは10分の再利用を
 *    効かせず、操作ごとに新しい grant を求める。
 */
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000;

/** POST /api/auth/step-up が受け付ける目的。ここに無い文字列は発行しない。 */
export const STEP_UP_PURPOSES = [
  'operations.control',
  'affiliate.payout.export',
  'photo.original.download',
  'staff.permissions.change',
  'staff.two_factor.remove',
  'line_account.connect',
  'line_account.credentials',
  'line_account.archive',
  'broadcast.approval',
  'webhook.api_token',
  'webhook.secret',
] as const;
export type StepUpPurpose = (typeof STEP_UP_PURPOSES)[number];

export function isStepUpPurpose(value: unknown): value is StepUpPurpose {
  return typeof value === 'string' && (STEP_UP_PURPOSES as readonly string[]).includes(value);
}

/** X-Step-Up-Token の1回限り grant を消費する。token が無ければそのまま false。 */
export async function consumeStepUpToken(
  c: Context<Env>,
  purpose: StepUpPurpose,
): Promise<boolean> {
  const staff = c.get('staff');
  const token = c.req.header('X-Step-Up-Token')?.trim();
  if (!staff || !token) return false;
  try {
    return await consumeStepUpGrant(c.env.DB, {
      tokenHash: await sha256Hex(token),
      staffId: staff.id,
      purpose,
    });
  } catch {
    // grant 台帳が読めないときも止める側に倒す（fail closed）。
    return false;
  }
}

/**
 * このリクエストが再確認済みか。通せるなら true、止めるなら false。
 * 止める側は 401 + code 'STEP_UP_REQUIRED' で応答を返す。
 */
export async function sensitiveStepUpSatisfied(
  c: Context<Env>,
  purpose: StepUpPurpose,
): Promise<boolean> {
  const staff = c.get('staff');
  if (!staff) return false;
  const tokenHash = await adminSessionTokenHashFromRequest(c);
  let session: Awaited<ReturnType<typeof getAdminSessionByTokenHash>> | null = null;
  if (tokenHash) {
    try {
      session = await getAdminSessionByTokenHash(c.env.DB, tokenHash);
    } catch {
      // セッション行が読めないときは窓を効かせず grant 側へ倒す。
      session = null;
    }
  }
  // いつもと違うセッションは窓を使わせず、操作ごとに1回限りの grant を求める。
  // 窓を効かせるのは本人のセッションに限る（他人のセッション行で通さない）。
  if (session?.staff_id === staff.id && !session.unfamiliar_at && session.step_up_at
    && Date.parse(session.step_up_at) > Date.now() - STEP_UP_WINDOW_MS) {
    return true;
  }
  return consumeStepUpToken(c, purpose);
}

/** 再確認が要るときの統一応答。 */
export function stepUpRequiredResponse(c: Context<Env>, detail: string): Response {
  return c.json({ success: false, error: detail, code: 'STEP_UP_REQUIRED' }, 401);
}
