import {
  listManualLinks,
  recordCheck,
} from '@line-crm/db';
import type { Env } from '../index.js';

/**
 * マニュアル導線の週1回の点検（要件 v6-34 §8-4）。台帳 #134。
 *
 * **開けたかどうかを、確かめて初めて言う。** URL が入っているだけでは
 * 「開けます」と書かない。読めなかったものは `broken` にして、
 * その旨を運営側へ1回だけ知らせる。
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 10_000;

/** 外部に出す URL として安全か。** 内部・私的アドレスは確かめに行かない。 */
export function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    if (
      host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.local')
      || host.endsWith('.internal')
      || /^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host)
    ) return false;
    const ipv4 = host.split('.').map(Number);
    if (ipv4.length === 4 && ipv4.every(Number.isInteger)) {
      if (ipv4[0] === 172 && ipv4[1]! >= 16 && ipv4[1]! <= 31) return false;
      if (ipv4[0] === 100 && ipv4[1]! >= 64 && ipv4[1]! <= 127) return false;
    }
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface ManualLinkCheckResult {
  checked: number;
  ok: number;
  broken: number;
  /** URL が決まっていないものは確かめようがない。broken に混ぜない。 */
  unset: number;
  unsafe: number;
  /** 今回の確認で新たに `broken` になったキー。通知はこれにだけ出す。 */
  newlyBroken: string[];
}

/**
 * 全部を確かめる。`broken` への転落は `newlyBroken` に入る——
 * 「前も壊れていた」ものには再度知らせない（§8-4 の「1回だけ」）。
 */
export async function checkAllManualLinks(
  db: D1Database,
  opts: { checkedBy?: string | null } = {},
): Promise<ManualLinkCheckResult> {
  const rows = await listManualLinks(db);
  const targets = rows.filter((row) => row.url && isSafePublicHttpsUrl(row.url));
  const newlyBroken: string[] = [];
  let ok = 0;
  let broken = 0;
  for (const row of targets) {
    let okNow: boolean;
    let httpStatus: number | undefined;
    let errorCode: string | null = null;
    try {
      const res = await fetch(row.url!, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      okNow = res.ok;
      httpStatus = res.status;
      if (!okNow) errorCode = `HTTP_${res.status}`;
    } catch {
      okNow = false;
      errorCode = 'NETWORK_ERROR';
    }
    await recordCheck(db, row.key, {
      ok: okNow,
      // 応答自体が無い失敗（timeout 等）に HTTP 0 を書かない——
      // 「読めなかった」と「404 が返った」を区別する。
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      errorCode,
      checkedBy: opts.checkedBy ?? null,
    });
    if (okNow) {
      ok += 1;
    } else {
      broken += 1;
      if (row.status !== 'broken') newlyBroken.push(row.key);
    }
  }
  return {
    checked: targets.length,
    ok,
    broken,
    unset: rows.filter((row) => !row.url).length,
    unsafe: rows.length - targets.length - rows.filter((row) => !row.url).length,
    newlyBroken,
  };
}

/**
 * 週1回の走査。cron から呼ぶ。**最終確認から7日を経るまでは何もしない**——
 * cron は短い間隔で回るので、ここで週1に絞る。
 */
export async function runWeeklyManualLinkCheck(
  db: D1Database,
): Promise<ManualLinkCheckResult | null> {
  const last = await db
    .prepare(`SELECT MAX(checked_at) AS latest FROM manual_link_check_history`)
    .first<{ latest: string | null }>();
  if (last?.latest && Date.now() - new Date(last.latest).getTime() < WEEK_MS) {
    return null;
  }
  return checkAllManualLinks(db, { checkedBy: 'cron' });
}

/**
 * 新たに壊れたリンクを運営へ1回だけ知らせる（§8-4）。
 * アカウントごとの運用者通知ルールに乗せる——既に壊れていたままの
 * リンクや、直ったリンクには出さない。
 */
export async function notifyBrokenManualLinks(
  db: D1Database,
  env: Env['Bindings'],
  newlyBroken: string[],
): Promise<void> {
  if (newlyBroken.length === 0) return;
  const { dispatchOperatorEvent } = await import('./operator-notification-dispatch.js');
  const rows = await db.prepare(`SELECT id FROM line_accounts WHERE is_active = 1`).all<{ id: string }>();
  for (const account of rows.results) {
    for (const key of newlyBroken) {
      await dispatchOperatorEvent(db, env, {
        lineAccountId: account.id,
        eventType: 'manual_link_broken',
        /*
          壊れたキーごとに1回。**「前も壊れていた」には出さない**ので、
          同じキーの通知が繰り返さない（§8-4 の「1回だけ」）。
        */
        sourceEventId: `manual_link_broken:${key}`,
        message: `マニュアルのリンクが開けなくなっています（${key}）。` +
          '正本表の管理画面で URL を直してください',
        executionMode: 'automatic',
      });
    }
  }
}
