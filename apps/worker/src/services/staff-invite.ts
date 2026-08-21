import type { Env } from '../index.js';

type Invite = { name: string; email: string; verifyUrl?: string; lineUrl?: string };

async function send(env: Env['Bindings'], input: { to: string; subject: string; body: string }): Promise<void> {
  const from = env.CONTACT_EMAIL || 'contact-shed@nen-petfood.com';
  if (env.XSERVER_RELAY_URL && env.XSERVER_RELAY_SECRET) {
    const { sendViaXServerRelay } = await import('./support-relay.js');
    await sendViaXServerRelay(env.XSERVER_RELAY_URL, env.XSERVER_RELAY_SECRET, input);
    return;
  }
  const { sendXServerMail } = await import('./xserver-mail.js');
  await sendXServerMail(env, { ...input, from });
}

export async function sendStaffInviteEmail(env: Env['Bindings'], input: Invite): Promise<void> {
  await send(env, { to: input.email, subject: '【然-NEN-】管理画面への招待', body: `${input.name} 様\n\n管理画面へ招待されました。次のURLからメールアドレスを確認してください。\n${input.verifyUrl}\n\nこのURLの有効期限は48時間です。` });
}

export async function sendStaffLineLinkEmail(env: Env['Bindings'], input: Invite): Promise<void> {
  await send(env, { to: input.email, subject: '【然-NEN-】LINE連携を完了してください', body: `${input.name} 様\n\nメールアドレスの確認が完了しました。次のURLからLINE認証を行うと、管理画面へログインできます。\n${input.lineUrl}\n\n以後のログインはLINEを使用します。` });
}
