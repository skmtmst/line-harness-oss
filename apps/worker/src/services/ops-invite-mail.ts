import type { Env } from '../index.js';
import { sendPlainMail } from './plain-mail.js';

/** 運営メンバーの招待メール（★V6 37-10）。URL と有効期限だけを書く。 */
export const OPS_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export async function sendOpsInviteMail(
  env: Env['Bindings'],
  input: { email: string; inviterName: string; acceptUrl: string; existingAccount: boolean },
): Promise<void> {
  await sendPlainMail(env, {
    to: input.email,
    subject: '【musubo】運営コンソールへの招待',
    body: [
      `${input.inviterName} さんから、musubo 運営コンソールの運営メンバーに招待されました。`,
      '',
      input.existingAccount
        ? '次の URL を開いてログインすると、2要素認証の登録に進みます。登録が終わると運営コンソールに入れます。'
        : '次の URL を開いて、お名前とパスワードを設定してください。続けて 2要素認証の登録が終わると運営コンソールに入れます。',
      input.acceptUrl,
      '',
      'この URL の有効期限は 24 時間です。期限が過ぎたときは、招待した運営メンバーに送り直しを依頼してください。',
      'お心当たりが無い場合は、このメールを破棄してください。登録は行われません。',
    ].join('\n'),
  });
}
