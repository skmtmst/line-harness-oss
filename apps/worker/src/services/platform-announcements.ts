import { LineClient } from '@line-crm/line-sdk';
import {
  consumeStaffLineLinkCode,
  finishAnnouncement,
  getLineAccountById,
  getPlatformSetting,
  insertAnnouncementRecipients,
  markRecipientDelivery,
  NOTICE_LINE_ACCOUNT_KEY,
  parseJsonArray,
  resolveAnnouncementAudience,
  type AnnouncementChannel,
  type AudienceStaffRow,
  type PlatformAnnouncement,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { sendPlainMail } from './plain-mail.js';

/**
 * 運営からのお知らせ配信 ★V6 37-7。
 *
 * 送り方は line（契約者専用LINE）／screen（統括の管理画面）／email（登録メール）。
 * LINE は契約者専用LINEの友だちとして紐づいた権限者にだけ push する（誰に届いたかを数えるため）。
 * LINE の Messaging API には既読の通知が無いので、画面には「送達」（push が受け付けられた数）を出す。
 */

export interface NoticeLineAccount {
  id: string;
  name: string;
  basicId: string | null;
  addFriendUrl: string | null;
  channelAccessToken: string;
}

/** 契約者専用LINEに指定されたアカウント。未指定・見つからない・保管済みなら null。 */
export async function loadNoticeLineAccount(env: Env['Bindings']): Promise<NoticeLineAccount | null> {
  const id = await getPlatformSetting(env.DB, NOTICE_LINE_ACCOUNT_KEY);
  if (!id) return null;
  const account = await getLineAccountById(env.DB, id);
  if (!account || account.archived_at) return null;
  const basicId = account.line_basic_id ? account.line_basic_id.replace(/^@/, '') : null;
  return {
    id: account.id,
    name: account.name,
    basicId: basicId ? `@${basicId}` : null,
    addFriendUrl: basicId ? `https://line.me/R/ti/p/@${encodeURIComponent(basicId)}` : null,
    channelAccessToken: account.channel_access_token,
  };
}

export function audienceOf(a: PlatformAnnouncement) {
  return {
    audienceKind: a.audience_kind,
    plans: parseJsonArray(a.audience_plans),
    tenantIds: parseJsonArray(a.audience_tenant_ids),
  };
}

export function channelsOf(a: PlatformAnnouncement): AnnouncementChannel[] {
  return parseJsonArray(a.channels).filter((c): c is AnnouncementChannel => c === 'line' || c === 'screen' || c === 'email');
}

/** 宛先の見積もり（画面の「15件の契約先・24人の権限者。うち LINE 登録済みの 21人へ届きます」）。 */
export async function previewAudience(env: Env['Bindings'], input: { audienceKind: PlatformAnnouncement['audience_kind']; plans: string[]; tenantIds: string[] }) {
  const rows = await resolveAnnouncementAudience(env.DB, { excludeTenantId: DEFAULT_TENANT_ID, ...input });
  return {
    tenants: new Set(rows.map((r) => r.tenant_id)).size,
    staff: rows.length,
    lineLinked: rows.filter((r) => r.line_user_id).length,
    withEmail: rows.filter((r) => r.staff_email).length,
  };
}

function lineText(a: PlatformAnnouncement, adminUrl: string): string {
  return [`【musubo からのお知らせ】${a.subject}`, '', a.body, '', `管理画面: ${adminUrl}/hq`].join('\n');
}

function mailBody(a: PlatformAnnouncement, staffName: string, adminUrl: string): string {
  return [`${staffName || 'ご担当者'} 様`, '', 'musubo 運営からのお知らせです。', '', '----------------------------------------', a.body, '----------------------------------------', '', `管理画面の上部にも同じお知らせを出しています: ${adminUrl}/hq`].join('\n');
}

/**
 * 1 件を送る。呼ぶ前に status を sending にしておく（claimDueAnnouncement / markAnnouncementSending）。
 * 宛先ごとに結果を残し、最後に件数を確定する。途中で落ちても宛先の記録は残る。
 */
export async function deliverAnnouncement(env: Env['Bindings'], a: PlatformAnnouncement): Promise<{ recipients: number; lineSent: number; lineFailed: number; mailSent: number; mailFailed: number }> {
  const channels = channelsOf(a);
  const rows = await resolveAnnouncementAudience(env.DB, { excludeTenantId: DEFAULT_TENANT_ID, ...audienceOf(a) });
  await insertAnnouncementRecipients(env.DB, a.id, rows.map((r) => ({ tenantId: r.tenant_id, staffId: r.staff_id, channels })));
  const adminUrl = (env.ADMIN_PUBLIC_URL ?? '').replace(/\/+$/, '');
  let lineSent = 0;
  let lineFailed = 0;
  let mailSent = 0;
  let mailFailed = 0;
  let lastError: string | null = null;

  const notice = channels.includes('line') ? await loadNoticeLineAccount(env) : null;
  if (channels.includes('line') && !notice) lastError = '契約者専用LINEのアカウントが未設定のため、LINE には送れませんでした';
  const client = notice ? new LineClient(notice.channelAccessToken) : null;

  for (const r of rows) {
    if (client && r.line_user_id) {
      try {
        await client.pushMessage(r.line_user_id, [{ type: 'text', text: lineText(a, adminUrl) }]);
        lineSent += 1;
        await markRecipientDelivery(env.DB, a.id, r.staff_id, { lineSentAt: nowJst() });
      } catch (error) {
        lineFailed += 1;
        const message = error instanceof Error ? error.message.slice(0, 200) : 'push failed';
        lastError = message;
        await markRecipientDelivery(env.DB, a.id, r.staff_id, { lineError: message });
      }
    }
    if (channels.includes('email') && r.staff_email) {
      try {
        await sendPlainMail(env, { to: r.staff_email, subject: `【musubo お知らせ】${a.subject}`, body: mailBody(a, r.staff_name, adminUrl) });
        mailSent += 1;
        await markRecipientDelivery(env.DB, a.id, r.staff_id, { mailSentAt: nowJst() });
      } catch (error) {
        mailFailed += 1;
        const message = error instanceof Error ? error.message.slice(0, 200) : 'mail failed';
        lastError = message;
        await markRecipientDelivery(env.DB, a.id, r.staff_id, { mailError: message });
      }
    }
  }
  const failed = rows.length > 0
    && ((channels.includes('line') && (!notice || (lineSent === 0 && lineFailed > 0))) || (channels.includes('email') && mailSent === 0 && mailFailed > 0))
    && !channels.includes('screen');
  await finishAnnouncement(env.DB, a.id, { recipientsTotal: rows.length, lineSent, lineFailed, mailSent, mailFailed, lastError, failed });
  return { recipients: rows.length, lineSent, lineFailed, mailSent, mailFailed };
}

function nowJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
}

/** cron: 公開日時を過ぎた予約を 1 回の実行で 1 件ずつ送る。 */
export async function processDueAnnouncements(env: Env['Bindings'], input: { now: string; max?: number }): Promise<{ sent: number }> {
  const { claimDueAnnouncement } = await import('@line-crm/db');
  let sent = 0;
  for (let i = 0; i < (input.max ?? 3); i += 1) {
    const a = await claimDueAnnouncement(env.DB, input.now);
    if (!a) break;
    try {
      await deliverAnnouncement(env, a);
      sent += 1;
    } catch (error) {
      console.error('[announcements] delivery failed', { id: a.id, message: error instanceof Error ? error.message : String(error) });
      await finishAnnouncement(env.DB, a.id, { recipientsTotal: 0, lineSent: 0, lineFailed: 0, mailSent: 0, mailFailed: 0, lastError: error instanceof Error ? error.message.slice(0, 200) : 'failed', failed: true });
    }
  }
  return { sent };
}

/**
 * Webhook: 契約者専用LINEに 6 桁の確認コードが届いたら、権限者と友だちを結ぶ。
 * 対象アカウント以外・6 桁以外は何もしない（false を返し、通常の処理に進む）。
 */
export async function tryLinkStaffByCode(
  env: Env['Bindings'],
  input: { lineAccountId: string | null; friendId: string; text: string; reply: (text: string) => Promise<void> },
): Promise<boolean> {
  if (!input.lineAccountId) return false;
  const code = input.text.trim();
  if (!/^\d{6}$/.test(code)) return false;
  const noticeAccountId = await getPlatformSetting(env.DB, NOTICE_LINE_ACCOUNT_KEY);
  if (!noticeAccountId || noticeAccountId !== input.lineAccountId) return false;
  const linked = await consumeStaffLineLinkCode(env.DB, { code, friendId: input.friendId });
  if (!linked) {
    await input.reply('確認コードが見つからないか、期限が切れています。管理画面でもう一度コードを表示して、その 6 桁を送ってください。').catch(() => {});
    return true;
  }
  await input.reply(`${linked.staffName} さんの管理画面と紐づきました。今後の大事なお知らせはここに届きます。`).catch(() => {});
  return true;
}

export type { AudienceStaffRow };
