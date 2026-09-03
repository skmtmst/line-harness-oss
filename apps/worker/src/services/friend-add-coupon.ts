import { jstNow } from '@line-crm/db';
import type { EccubeCouponInput } from './eccube-coupon.js';

export const FRIEND_ADD_COUPON_SETTING_KEY = 'nen.friend_add_coupon';

export const DEFAULT_FRIEND_ADD_COUPON_MESSAGE = [
  '友だち追加ありがとうございます🌿',
  '',
  '然-NEN-公式オンラインストアで使える、会員限定{discount_rate}%OFFクーポンをプレゼントします。',
  '',
  'クーポンコード：{coupon_code}',
  '有効期限：{expires_on}まで',
  '※会員ログイン後にご利用ください。',
  '※お一人様1回限りです。',
  '',
  '然-NEN-公式オンラインストアでは、お買い物金額に応じてポイントが貯まります。',
  '今後は、お買い物以外でもポイントが貯まる企画や、貯めたポイントで受け取れる特典をLINEで順次ご案内します🌿',
  '',
  '▼オンラインストア',
  'https://nen-petfood.com/',
].join('\n');

const LEGACY_GENERATED_COUPON_MESSAGE = [
  '友だち追加ありがとうございます🌿',
  '',
  '初回のお買い物に使える{discount_rate}%OFFクーポンをプレゼントします。',
  'クーポンコード：{coupon_code}',
  '有効期限：{expires_on}まで',
  '※お一人様1回限りです。',
].join('\n');

export type FriendAddCouponSetting = {
  isEnabled: boolean;
  deliveryMode: 'generated' | 'shared';
  codePrefix: string;
  discountRate: number;
  validityDays: number;
  couponName: string;
  sharedCouponCode: string | null;
  sharedValidTo: string | null;
  messageTemplate: string;
};

type IssueRow = {
  coupon_code: string;
  discount_rate: number;
  valid_from: string;
  expires_at: string;
  status: 'pending' | 'coupon_created' | 'sent' | 'failed_create' | 'failed_send';
};

export type FriendAddCouponDependencies = {
  createCoupon: (coupon: EccubeCouponInput) => Promise<void>;
  sendText: (text: string) => Promise<void>;
};

function jstIsoDate(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.toISOString().slice(0, 19)}+09:00`;
}

function parseSetting(value: string | null): FriendAddCouponSetting | null {
  if (!value) return null;
  try {
    const setting = JSON.parse(value) as Partial<FriendAddCouponSetting>;
    const deliveryMode = setting.deliveryMode === 'shared' ? 'shared' : 'generated';
    const prefix = String(setting.codePrefix ?? '').trim().toUpperCase();
    const sharedCouponCode = String(setting.sharedCouponCode ?? '').trim().toUpperCase();
    const sharedValidTo = String(setting.sharedValidTo ?? '').trim();
    const messageTemplate = String(
      setting.messageTemplate
      ?? (deliveryMode === 'shared' ? DEFAULT_FRIEND_ADD_COUPON_MESSAGE : LEGACY_GENERATED_COUPON_MESSAGE),
    ).trim();
    if (
      typeof setting.isEnabled !== 'boolean'
      || !Number.isInteger(setting.discountRate)
      || Number(setting.discountRate) < 1
      || Number(setting.discountRate) > 100
      || messageTemplate.length === 0
      || messageTemplate.length > 2000
      || !messageTemplate.includes('{coupon_code}')
      || !messageTemplate.includes('{expires_on}')
    ) return null;
    if (deliveryMode === 'generated' && (
      !/^[A-Z0-9]{2,7}$/.test(prefix)
      || !Number.isInteger(setting.validityDays)
      || Number(setting.validityDays) < 1
      || Number(setting.validityDays) > 365
      || typeof setting.couponName !== 'string'
      || setting.couponName.trim().length === 0
      || setting.couponName.trim().length > 50
    )) return null;
    if (deliveryMode === 'shared' && (
      !/^[A-Z0-9-]{3,20}$/.test(sharedCouponCode)
      || !/^\d{4}-\d{2}-\d{2}$/.test(sharedValidTo)
      || Number.isNaN(Date.parse(`${sharedValidTo}T23:59:59+09:00`))
    )) return null;
    return {
      isEnabled: setting.isEnabled,
      deliveryMode,
      codePrefix: prefix,
      discountRate: setting.discountRate!,
      validityDays: setting.validityDays ?? 1,
      couponName: setting.couponName?.trim() || 'LINE友だち追加クーポン',
      sharedCouponCode: deliveryMode === 'shared' ? sharedCouponCode : null,
      sharedValidTo: deliveryMode === 'shared' ? sharedValidTo : null,
      messageTemplate,
    };
  } catch {
    return null;
  }
}

export async function getFriendAddCouponSetting(
  db: D1Database,
  lineAccountId: string,
): Promise<FriendAddCouponSetting | null> {
  const row = await db.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?`,
  ).bind(lineAccountId, FRIEND_ADD_COUPON_SETTING_KEY).first<{ value: string }>();
  return parseSetting(row?.value ?? null);
}

function formatJapaneseDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value.slice(0, 10);
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

export function buildFriendAddCouponMessage(issue: {
  code: string;
  discountRate: number;
  expiresAt: string;
  messageTemplate?: string;
}): string {
  const replacements: Record<string, string> = {
    coupon_code: issue.code,
    discount_rate: String(issue.discountRate),
    expires_on: formatJapaneseDate(issue.expiresAt),
  };
  return (issue.messageTemplate ?? DEFAULT_FRIEND_ADD_COUPON_MESSAGE).replace(
    /\{(coupon_code|discount_rate|expires_on)\}/g,
    (_match, key: string) => replacements[key] ?? '',
  );
}

export async function issueFriendAddCoupon(
  db: D1Database,
  input: { lineAccountId: string; friendId: string; now?: Date },
  dependencies: FriendAddCouponDependencies,
): Promise<'disabled' | 'sent' | 'already_sent'> {
  const setting = await getFriendAddCouponSetting(db, input.lineAccountId);
  if (!setting?.isEnabled) return 'disabled';

  const now = input.now ?? new Date();
  const validFrom = jstIsoDate(now);
  const expiresAt = setting.deliveryMode === 'shared'
    ? `${setting.sharedValidTo}T23:59:59+09:00`
    : jstIsoDate(new Date(now.getTime() + setting.validityDays * 86_400_000));
  const createdAt = jstNow();
  const couponCode = setting.deliveryMode === 'shared'
    ? setting.sharedCouponCode!
    : `${setting.codePrefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  const initialStatus = setting.deliveryMode === 'shared' ? 'coupon_created' : 'pending';
  await db.prepare(
    `INSERT OR IGNORE INTO nen_friend_add_coupon_issues
      (id, line_account_id, friend_id, coupon_code, discount_rate, valid_from, expires_at,
       status, issued_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.lineAccountId, input.friendId, couponCode,
    setting.discountRate, validFrom, expiresAt, initialStatus,
    setting.deliveryMode === 'shared' ? createdAt : null, createdAt, createdAt,
  ).run();

  const issue = await db.prepare(
    `SELECT coupon_code, discount_rate, valid_from, expires_at, status
       FROM nen_friend_add_coupon_issues
      WHERE line_account_id = ? AND friend_id = ?`,
  ).bind(input.lineAccountId, input.friendId).first<IssueRow>();
  if (!issue) throw new Error('friend_add_coupon_issue_missing');
  if ('sent' === issue.status) return 'already_sent';

  if ('coupon_created' !== issue.status && 'failed_send' !== issue.status) {
    try {
      await dependencies.createCoupon({
        code: issue.coupon_code,
        name: setting.couponName,
        discountType: 'rate',
        discountRate: issue.discount_rate,
        validFrom: issue.valid_from,
        validTo: issue.expires_at,
        memberOnly: false,
      });
      await db.prepare(
        `UPDATE nen_friend_add_coupon_issues
            SET status = 'coupon_created', last_error = NULL, issued_at = ?, updated_at = ?
          WHERE line_account_id = ? AND friend_id = ?`,
      ).bind(createdAt, createdAt, input.lineAccountId, input.friendId).run();
    } catch {
      await db.prepare(
        `UPDATE nen_friend_add_coupon_issues
            SET status = 'failed_create', last_error = 'coupon_create_failed', updated_at = ?
          WHERE line_account_id = ? AND friend_id = ?`,
      ).bind(createdAt, input.lineAccountId, input.friendId).run();
      throw new Error('friend_add_coupon_create_failed');
    }
  }

  try {
    await dependencies.sendText(buildFriendAddCouponMessage({
      code: issue.coupon_code,
      discountRate: issue.discount_rate,
      expiresAt: issue.expires_at,
      messageTemplate: setting.messageTemplate,
    }));
    await db.prepare(
      `UPDATE nen_friend_add_coupon_issues
          SET status = 'sent', last_error = NULL, sent_at = ?, updated_at = ?
        WHERE line_account_id = ? AND friend_id = ?`,
    ).bind(createdAt, createdAt, input.lineAccountId, input.friendId).run();
  } catch {
    await db.prepare(
      `UPDATE nen_friend_add_coupon_issues
          SET status = 'failed_send', last_error = 'line_send_failed', updated_at = ?
        WHERE line_account_id = ? AND friend_id = ?`,
    ).bind(createdAt, input.lineAccountId, input.friendId).run();
    throw new Error('friend_add_coupon_send_failed');
  }

  return 'sent';
}
