import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';

/*
 * N-432(#668)。招待メールが伝える有効期限を、実際に送る本文で確かめる。
 *
 * 期限そのものは staff.ts の INVITE_TTL_MS が決める。本文がそれと食い違うと、
 * 受け取った人は「切れた」と思って捨てる/切れていないと思って放置する。
 * どちらも招待が完了しない。本文の数字を見張る。
 */
const relay = vi.hoisted(() => ({ sendXServerMail: vi.fn() }));
vi.mock('./xserver-mail.js', () => relay);

const { sendStaffInviteEmail } = await import('./staff-invite.js');

function env(): Env['Bindings'] {
  return { CONTACT_EMAIL: 'contact@example.test' } as Env['Bindings'];
}

beforeEach(() => {
  relay.sendXServerMail.mockReset();
  relay.sendXServerMail.mockResolvedValue(undefined);
});

describe('招待メールの有効期限の案内', () => {
  it('7日と伝える(48時間とは書かない)', async () => {
    await sendStaffInviteEmail(env(), {
      name: '招待された人', email: 'invitee@example.test',
      verifyUrl: 'https://admin.example.test/staff/invite#invite=token',
    });
    const body = relay.sendXServerMail.mock.calls[0][1].body as string;
    expect(body).toContain('7日間');
    expect(body).not.toContain('48時間');
    expect(body).toContain('https://admin.example.test/staff/invite#invite=token');
  });
});
