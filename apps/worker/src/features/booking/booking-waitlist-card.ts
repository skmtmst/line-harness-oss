/**
 * キャンセル待ちの空き知らせは、空いた日時、メニュー・担当者、仮押さえ期限を伝える。
 * この時間で予約する → {LIFF}/booking?waitlist=<待ちID>
 * 今回は見送る → {LIFF}/booking/waitlist/<待ちID>/decline
 * 見送りの確定後は待ちを取り消して次の組へ回す。自動通知なので X-Line-Harness-Source: manual は付けない。設計図 fLNQx と照合する。
 */
import { LineClient } from '@line-crm/line-sdk';
import {
  flexBox,
  flexBubble,
  flexButton,
  flexText,
  type FlexBubble,
} from '@line-crm/line-sdk';


import { normalizeTimeZone, tzHHMM } from '../../services/availability.js';

export const WAITLIST_BOOK_PATH = '/booking';
export const WAITLIST_DECLINE_PATH = (waitlistId: string): string =>
  `/booking/waitlist/${waitlistId}/decline`;

/** 空き枠入りの予約画面の URL。 */
export function waitlistBookUrl(liffBaseUrl: string, waitlistId: string): string {
  return `${liffBaseUrl.replace(/\/$/, '')}${WAITLIST_BOOK_PATH}?waitlist=${encodeURIComponent(waitlistId)}`;
}

/** 待ちの取り消し確認の URL。 */
export function waitlistDeclineUrl(liffBaseUrl: string, waitlistId: string): string {
  return `${waitlistBookUrl(liffBaseUrl,waitlistId)}&action=decline`;
}

/** 店の時間帯で「10月2日（金）13:00」を作る。曜日は暦で確かめたもの。 */
export function formatSlotHeadline(startsAtUtcIso: string, timeZone: string): string {
  const tz = normalizeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: tz,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(startsAtUtcIso));
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('month')}月${get('day')}日（${get('weekday')}）${get('hour')}:${get('minute')}`;
}

export interface WaitlistInviteCardInput {
  headline: string;
  detail: string;
  holdLine: string;
  bookUrl: string;
  declineUrl: string;
}

export function buildWaitlistInviteBubble(input: WaitlistInviteCardInput): FlexBubble {
  return flexBubble({
    body: flexBox('vertical', [
      flexText('キャンセル待ちのお知らせ', { size: 'xs', color: '#8B6F47' }),
      flexText(`${input.headline} に空きが出ました`, {
        size: 'lg', weight: 'bold', wrap: true, margin: 'md',
      }),
      flexText(input.detail, { size: 'sm', color: '#666666', wrap: true, margin: 'md' }),
      flexText(input.holdLine, { size: 'sm', color: '#666666', wrap: true }),
    ]),
    footer: flexBox('vertical', [
      flexButton(
        { type: 'uri', label: 'この時間で予約する', uri: input.bookUrl },
        { style: 'primary', color: '#06C755' },
      ),
      flexButton(
        { type: 'uri', label: '今回は見送る', uri: input.declineUrl },
        { style: 'link', margin: 'md' },
      ),
    ]),
  });
}

export interface WaitlistInviteSendParams {
  channelAccessToken: string;
  toLineUserId: string;
  bubble: FlexBubble;
  altText: string;
}

export type WaitlistInviteSender = (params: WaitlistInviteSendParams) => Promise<void>;

export async function sendWaitlistInviteCard(params: WaitlistInviteSendParams): Promise<void> {
  const client = new LineClient(params.channelAccessToken);
  await client.pushFlexMessage(params.toLineUserId, params.altText, params.bubble);
}
