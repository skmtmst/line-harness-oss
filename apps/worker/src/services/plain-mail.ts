import type { Env } from '../index.js';

/**
 * 運用者向けの文字だけのメールを1通送る。
 *
 * 送り方は権限者の招待メールと同じ（Xserver の中継か、Xserver の SMTP）。
 * 秘密の値は env から読むだけで、ここには書かない。
 */
export async function sendPlainMail(
  env: Env['Bindings'],
  input: { to: string; subject: string; body: string },
): Promise<void> {
  const from = env.CONTACT_EMAIL || 'contact-shed@nen-petfood.com';
  if (env.XSERVER_RELAY_URL && env.XSERVER_RELAY_SECRET) {
    const { sendViaXServerRelay } = await import('./support-relay.js');
    await sendViaXServerRelay(env.XSERVER_RELAY_URL, env.XSERVER_RELAY_SECRET, input);
    return;
  }
  const { sendXServerMail } = await import('./xserver-mail.js');
  await sendXServerMail(env, { ...input, from });
}
