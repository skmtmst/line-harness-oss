import type { Env } from '../worker-env.js';
import { sendPlainMail } from './plain-mail.js';

/**
 * 会員登録・パスワード再設定メールは musubo 名義で送る。本文は URL と有効期限に絞り、パスワードなど不要な秘密を含めない。
 */

export const SIGNUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * 送信元を本文からも確認できるよう、musubo 名義の署名を末尾に付ける。差出人不明の短文として迷惑メールに分類されるのを避ける。
 */
const MAIL_FOOTER = ['', '---', 'musubo（ムスボ）', 'https://admin.musubo.jp', 'このメールは送信専用です。'];

export async function sendRegistrationReceiptMail(env: Env['Bindings'], input: { email: string; companyName: string }): Promise<void> {
  await sendPlainMail(env, {
    to: input.email,
    subject: '【musubo】お申し込みを受け付けました',
    body: [
      `${input.companyName} 様`, '',
      'musubo へのお申し込みを受け付けました。',
      '内容を確認し、担当者からご連絡します。承認のご案内が届くまで musubo は利用できません。',
      'お心当たりが無い場合は、このメールを破棄してください。',
      ...MAIL_FOOTER,
    ].join('\n'),
  });
}

export async function sendSignupVerifyMail(env: Env['Bindings'], input: { email: string; completeUrl: string }): Promise<void> {
  await sendPlainMail(env, {
    to: input.email,
    subject: '【musubo】利用開始のご案内',
    body: [
      'musubo へのお申し込みが承認されました。',
      '',
      '次の URL を開いて、パスワードを設定すると利用を開始できます。',
      input.completeUrl,
      '',
      'この URL の有効期限は 24 時間です。期限が過ぎたときは musubo の担当者へお問い合わせください。',
      'お心当たりが無い場合は、このメールを破棄してください。登録は行われません。',
      ...MAIL_FOOTER,
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
      ...MAIL_FOOTER,
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
      ...MAIL_FOOTER,
    ].join('\n'),
  });
}
