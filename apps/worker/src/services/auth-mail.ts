import type { Env } from '../index.js';
import { sendPlainMail } from './plain-mail.js';

/**
 * 会員登録・パスワード再設定で送るメール（★V6 36-4／36-6）。
 *
 * 件名の呼び名は「musubo」（決定 2026-09-13）。本文には URL と有効期限だけを書き、
 * パスワードやトークン以外の秘密は入れない。
 */

export const SIGNUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export async function sendSignupVerifyMail(env: Env['Bindings'], input: { email: string; completeUrl: string }): Promise<void> {
  await sendPlainMail(env, {
    to: input.email,
    subject: '【musubo】メールアドレスの確認と本登録',
    body: [
      'musubo にご登録いただきありがとうございます。',
      '',
      '次の URL を開いて、会社名・お名前・パスワードを入力すると本登録が完了します。',
      input.completeUrl,
      '',
      'この URL の有効期限は 24 時間です。期限が過ぎたときは、登録画面からもう一度メールアドレスを入力してください。',
      'お心当たりが無い場合は、このメールを破棄してください。登録は行われません。',
    ].join('\n'),
  });
}

export async function sendAlreadyRegisteredMail(env: Env['Bindings'], input: { email: string; loginUrl: string; forgotUrl: string }): Promise<void> {
  await sendPlainMail(env, {
    to: input.email,
    subject: '【musubo】このメールアドレスはすでに登録されています',
    body: [
      'musubo への登録のお申し込みを受け付けましたが、このメールアドレスはすでに登録されています。',
      '',
      'ログインはこちら',
      input.loginUrl,
      '',
      'パスワードを忘れた場合はこちら',
      input.forgotUrl,
      '',
      'お心当たりが無い場合は、このメールを破棄してください。',
    ].join('\n'),
  });
}

export async function sendPasswordResetMail(env: Env['Bindings'], input: { email: string; name: string; resetUrl: string }): Promise<void> {
  await sendPlainMail(env, {
    to: input.email,
    subject: '【musubo】パスワードの再設定',
    body: [
      `${input.name} 様`,
      '',
      '次の URL を開いて、新しいパスワードを設定してください。',
      input.resetUrl,
      '',
      'この URL の有効期限は 1 時間です。設定すると、ほかの端末のログインはすべて解除されます。',
      'お心当たりが無い場合は、このメールを破棄してください。パスワードは変わりません。',
    ].join('\n'),
  });
}
