/**
 * Cloudflare Turnstile（ロボット対策）の検証。★V6 36-4 会員登録・パスワード再設定。
 *
 * 画面の部品が出したトークンを Cloudflare に送って本物か確かめる。
 * 秘密の鍵 `TURNSTILE_SECRET_KEY` が無いときは「未設定」として断る（安全側）。
 * 値は Git にもチャットにも書かない。
 */

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'missing_token' | 'rejected' | 'unavailable' };

export async function verifyTurnstile(
  env: { TURNSTILE_SECRET_KEY?: string },
  token: string | null | undefined,
  remoteIp: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return { ok: false, reason: 'not_configured' };
  const value = typeof token === 'string' ? token.trim() : '';
  if (!value || value.length > 2048) return { ok: false, reason: 'missing_token' };

  const form = new URLSearchParams({ secret, response: value });
  if (remoteIp) form.set('remoteip', remoteIp);
  try {
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    const body = (await response.json()) as { success?: boolean };
    return body.success === true ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** 画面に出す言葉。理由ごとに分ける（設定の不備を利用者のせいにしない）。 */
export function turnstileErrorMessage(reason: Exclude<TurnstileResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'not_configured':
      return 'ロボット対策の設定が済んでいないため、いまは受け付けられません。運営にお問い合わせください';
    case 'missing_token':
      return 'ロボットでないことの確認が済んでいません。画面のチェックを完了してからもう一度お試しください';
    case 'unavailable':
      return 'ロボットでないことの確認ができませんでした。しばらく待ってからもう一度お試しください';
    default:
      return 'ロボットでないことの確認に失敗しました。ページを読み直してもう一度お試しください';
  }
}
