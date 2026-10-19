import { type Context } from 'hono';
import type { Env } from '../../worker-env.js';

// ---- 予約の変更履歴 (N-394) ----

export interface BookingNotificationPolicy {
  send_line_confirmation: boolean;
  day_before: boolean;
  hours_before: boolean;
}

export const NOTIFICATION_POLICY_KEYS = ['send_line_confirmation', 'day_before', 'hours_before'] as const;

/**
 * 保存ずみの通知方針を読む。未保存の旧予約 (snapshot='{}') は
 * 「連携済みなら全部送る」従来挙動に合わせて全て true とみなす。
 */
export function readNotificationPolicySnapshot(raw: string | null): BookingNotificationPolicy {
  let parsed: Record<string, unknown> = {};
  try {
    const value = raw ? JSON.parse(raw) : {};
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    /* 壊れた snapshot は既定値へ倒す */
  }
  return {
    send_line_confirmation: parsed.send_line_confirmation !== false,
    day_before: parsed.day_before !== false,
    hours_before: parsed.hours_before !== false,
  };
}

/** 通知方針の変更分だけを受け取る。不明なキー・非booleanは拒否する。 */
export function readNotificationPolicyPatch(raw: unknown):
  | { ok: true; value: Partial<BookingNotificationPolicy> }
  | { ok: false } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const input = raw as Record<string, unknown>;
  const unknown = Object.keys(input).find(
    (key) => !(NOTIFICATION_POLICY_KEYS as readonly string[]).includes(key),
  );
  if (unknown) return { ok: false };
  const out: Partial<BookingNotificationPolicy> = {};
  for (const key of NOTIFICATION_POLICY_KEYS) {
    if (Object.hasOwn(input, key)) {
      if (typeof input[key] !== 'boolean') return { ok: false };
      out[key] = input[key] as boolean;
    }
  }
  return { ok: true, value: out };
}

/** 監査行の actor を操作者 (管理画面のスタッフ) から作る。 */
export function staffAuditActor(c: Context<Env>) {
  const staff = c.get('staff');
  return {
    actorType: 'staff' as const,
    actorId: staff?.id ?? null,
    actorName: staff?.name ?? null,
  };
}

/**
 * 一括モードで受け付けるメニュー数の上限。カレンダーは公開中メニュー全部を
 * まとめて聞くので、通常の店舗規模（数十件）には十分。悪意ある巨大な
 * カンマ列で D1 を何往復もさせないための天井。
 */
export const AVAILABILITY_BATCH_MAX_MENUS = 50;
