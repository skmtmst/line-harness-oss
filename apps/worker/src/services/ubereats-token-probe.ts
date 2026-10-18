/**
 * Uber Eats Sandbox への最小の実接続（client_credentials のトークン取得）を
 * 1回だけ行うための層。画面は持たない。
 *
 * なぜ必要か:
 * - Application ID と Client Secret は配備先の暗号化された秘密設定で、読み戻せない。
 *   外から curl で叩くには秘密値を取り出すことになるため、取り出さずに
 *   「配備先の中から1回だけ送る」入口を用意する。
 * - 返すのは「取れたか・取れなかったか」と、返ってきた `scope` と、
 *   失敗ならHTTP状態と分類済みの符号だけ。
 *   **トークンの値と Client Secret は返さない・記録しない。**
 *
 * 守りの決まり:
 * - 接続先が Sandbox でないときは送らない（本番の Uber へは絶対に送らない）。
 * - 冷却時間の中では送らない。Uber のトークンの口は1時間100回までで、
 *   超えると 429 が返り、先に取ったトークンが無効になる。
 * - 合言葉の確認（署名）は呼び出し側の経路が持つ。
 */

import { getPlatformSetting, setPlatformSetting } from '@line-crm/db';
import { UberEatsError, fetchApplicationToken, type FetchLike } from './uber-eats.js';
import { UBER_SANDBOX_HOSTS, uberHosts } from './uber-eats-hosts.js';
import { uberOAuthClient, type DeliveryEnv } from './restaurant-delivery.js';

/** 一回実行の口を開ける合言葉。配備先の秘密設定に入れる。未設定のあいだ口は閉じたまま。 */
export interface UberProbeEnv extends DeliveryEnv {
  RT_DELIVERY_UBEREATS_PROBE_SECRET?: string;
}

/** 最後に送った時刻（通算ミリ秒）を置く鍵。`platform_settings` を使う（移行は不要）。 */
export const UBER_PROBE_LAST_RUN_KEY = 'rt_delivery_ubereats_probe_last_ms';
/** 冷却時間。連打で Uber のトークンの口（1時間100回）を使い切らないための幅。 */
export const UBER_PROBE_COOLDOWN_MS = 10 * 60_000;
/** 最初の接続確認で頼む権限。注文の受け取りの口ひとつだけに絞る。 */
export const UBER_PROBE_SCOPES = ['eats.order'] as const;
/** 台帳に残す書き手の名。画面から来る操作ではないので固定の名を置く。 */
const UBER_PROBE_ACTOR = 'ubereats-sandbox-probe';

/** 接続確認の結果。成功でもトークンの値は持たない。 */
export type UberProbeOutcome =
  | { kind: 'ok'; scope: string[]; expiresInSec: number }
  /** 接続先・ID・秘密値・戻り先のどれかが足りず、口が開いていない。 */
  | { kind: 'not_configured' }
  /** 接続先が Sandbox ではない。本番の Uber へは送らない。 */
  | { kind: 'sandbox_only' }
  | { kind: 'cooldown'; retryAfterSec: number }
  /** Uber が断った。HTTP状態と分類済みの符号だけを持つ。自由文は持たない。 */
  | { kind: 'uber_error'; status: number | null; code: string; uberCode: string }
  /** 届かなかった（通信の失敗・相手の形が読めない）。 */
  | { kind: 'network_failed' };

/** 最後に送った時刻の読み書き。試験では作り物に差し替える。 */
export interface UberProbeCooldownStore {
  read(): Promise<number | null>;
  write(nowMs: number): Promise<void>;
}

/** 合言葉の長さの下限。総当たりで当てられない長さ。配備先で作って秘密設定へ入れる。 */
export const UBER_PROBE_SECRET_MIN_LENGTH = 32;

/**
 * 口が開かない理由。配備先で「秘密設定の名前はあるのに未設定と返る」ときの切り分けに使う。
 *
 * - `probe_secret_missing`: その要求を受けた配備先に値が届いていない。
 *   別の Worker へ入れた、版が入れ替わる前に叩いた、名前の綴りが違う、のどれか。
 * - `probe_secret_too_short`: 値はあるが下限より短い。作り方の取り違え。
 *
 * 返すのは理由の符号だけ。**長さも値も返さない**（この分岐は署名の確認より前に通るため）。
 */
export type UberProbeSecretProblem = 'probe_secret_missing' | 'probe_secret_too_short';

/** 合言葉の読み取り結果。開いているときだけ値を持つ。 */
export type UberProbeSecretState =
  | { ok: true; secret: string }
  | { ok: false; code: UberProbeSecretProblem };

/** 口を開ける合言葉を読む。読めないときは理由の符号を添えて閉じたままにする。 */
export function uberProbeSecret(env: UberProbeEnv): UberProbeSecretState {
  const secret = env.RT_DELIVERY_UBEREATS_PROBE_SECRET?.trim();
  if (!secret) return { ok: false, code: 'probe_secret_missing' };
  if (secret.length < UBER_PROBE_SECRET_MIN_LENGTH) return { ok: false, code: 'probe_secret_too_short' };
  return { ok: true, secret };
}

/** 下見の本文。これを署名して送ると、Uber へは送らずに設定の状態だけが返る。 */
export const UBER_PROBE_CHECK_BODY = '{"mode":"check"}';

/**
 * 下見の答え。合言葉と署名が通ることの確認に使う。
 *
 * Uber へは送らないので、トークンの口の回数（1時間100回）も冷却時間も使わない。
 * 返すのは接続先の名と「OAuth の設定が揃っているか」だけで、ID・秘密値は返さない。
 */
export function uberProbeReadiness(env: UberProbeEnv): {
  environment: 'sandbox' | 'other' | 'unknown';
  oauthConfigured: boolean;
} {
  const hosts = uberHosts(env);
  const environment = !hosts
    ? 'unknown'
    : hosts.tokenUrl === UBER_SANDBOX_HOSTS.tokenUrl
      ? 'sandbox'
      : 'other';
  return { environment, oauthConfigured: uberOAuthClient(env) !== null };
}

/** `platform_settings` を使う冷却時間の置き場。配備済みの表なので移行は要らない。 */
export function platformCooldownStore(db: D1Database): UberProbeCooldownStore {
  return {
    read: async () => {
      const value = await getPlatformSetting(db, UBER_PROBE_LAST_RUN_KEY);
      if (!value) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    },
    write: async (nowMs) => {
      await setPlatformSetting(db, UBER_PROBE_LAST_RUN_KEY, String(nowMs), UBER_PROBE_ACTOR);
    },
  };
}

/**
 * Uber Sandbox へトークンを1回だけ求める。
 *
 * 送る前に時刻を残す。途中で落ちても1回分として数え、
 * 失敗の連打で Uber の口を使い切らないようにする（あとで原因を直してから冷却明けに再試行する）。
 */
export async function probeUberSandboxToken(input: {
  env: UberProbeEnv;
  store: UberProbeCooldownStore;
  fetch: FetchLike;
  nowMs: number;
}): Promise<UberProbeOutcome> {
  const hosts = uberHosts(input.env);
  if (!hosts) return { kind: 'not_configured' };
  // 本番の Uber へは送らない。書き間違いも Sandbox 以外は全部ここで止める。
  if (hosts.tokenUrl !== UBER_SANDBOX_HOSTS.tokenUrl) return { kind: 'sandbox_only' };
  const client = uberOAuthClient(input.env);
  if (!client) return { kind: 'not_configured' };

  const lastMs = await input.store.read();
  if (lastMs !== null) {
    const elapsed = input.nowMs - lastMs;
    if (elapsed >= 0 && elapsed < UBER_PROBE_COOLDOWN_MS) {
      return { kind: 'cooldown', retryAfterSec: Math.ceil((UBER_PROBE_COOLDOWN_MS - elapsed) / 1000) };
    }
  }
  await input.store.write(input.nowMs);

  try {
    const token = await fetchApplicationToken({
      client,
      fetch: input.fetch,
      scopes: UBER_PROBE_SCOPES,
      nowMs: input.nowMs,
    });
    // 返すのは権限の名と残り秒だけ。token.accessToken はここから先へ持ち出さない。
    return {
      kind: 'ok',
      scope: token.scope,
      expiresInSec: Math.max(0, Math.round((token.expiresAtMs - input.nowMs) / 1000)),
    };
  } catch (error) {
    if (error instanceof UberEatsError) {
      // error.kind は弊社の分類、error.message は Uber が返した符号（`uber_token_<符号>`）。
      // どちらも英小数字と `_` だけの固定語で、自由文・秘密値は含まない。
      return { kind: 'uber_error', status: error.status, code: error.kind, uberCode: error.message };
    }
    return { kind: 'network_failed' };
  }
}
