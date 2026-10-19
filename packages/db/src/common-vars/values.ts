import { type CommonVarType, type CommonVarResolution, type CommonVarResolutionEntry, type CommonVarResolutionFailureReason } from './resolution-types.js';
import { type CommonVar } from './record-types.js';


/** 値は文字列のまま差し込む。型ごとの表記だけをここで一意に整える。 */
export function normalizeCommonVarValue(type: CommonVarType, value: string): string | null {
  if (type === 'long_text') return value.length <= 10_000 ? value : null;
  if (type === 'boolean') return value === 'true' || value === 'false' ? value : null;
  /*
   * 画像はLINEへ画像URLとして差し込まれる。URLでない文字列や https 以外の
   * scheme は送信時に壊れるため、口で止める（VAR-03）。空は「空のまま」
   * 運用があるため通す。要件のメディアID参照(-14 §5-2)へ移るまでは、
   * 最小の形式検査として https URL だけを受ける。
   */
  if (type === 'image') {
    if (value === '') return value;
    return value.length <= 200 && /^https:\/\/\S+$/.test(value) ? value : null;
  }
  /*
   * URL型はリンク先として差し込まれる。URLでない文章は配信・予約導線で
   * 壊れるため、口で止める（R36）。画像と違い、社内・検証環境の http
   * リンクも運用するため http/https の両方を受ける。空は「空のまま」
   * 運用があるため通す。
   */
  if (type === 'url') {
    if (value === '') return value;
    return value.length <= 200 && /^https?:\/\/\S+$/.test(value) ? value : null;
  }
  if (type === 'date' || type === 'datetime') {
    const match = type === 'date'
      ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
      : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const [year, month, day, hour = '00', minute = '00'] = match.slice(1);
    const at = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
    return at.getUTCFullYear() === Number(year) && at.getUTCMonth() === Number(month) - 1
      && at.getUTCDate() === Number(day) && at.getUTCHours() === Number(hour)
      && at.getUTCMinutes() === Number(minute) ? value : null;
  }
  return value.length <= 200 ? value : null;
}

/*
 * Q: 鍵の形・長い乱数は共通情報に保存させない。
 * APIキーやトークンを本文差し込みへ置くと、配信・フォーム・公開画面の
 * どこへでも漏れる。秘密情報は外部連携の保管場所へ入れる決まり。
 *
 * 見立ては2系統。有名な鍵の形（Stripe/AWS/Google/JWT/PEM/Slack）と、
 * 空白を含まない長い乱数（32文字以上で英数字の混ざったもの）。電話番号や
 * 営業時間のような普通の文はどちらにも当たらない。
 */
export const SECRET_SHAPED_PATTERNS: readonly RegExp[] = [
  /sk[-_](live|test|prod)?[-_]?[A-Za-z0-9]{10,}/i,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /xox[baprs]-[0-9A-Za-z-]{10,}/,
  /ya29\.[0-9A-Za-z_-]{10,}/,
  // 32桁以上の16進数はチャネルシークレットやハッシュの形。
  /^[0-9a-f]{32,}$/i,
];

export function isSecretLikeValue(value: string): boolean {
  if (SECRET_SHAPED_PATTERNS.some((pattern) => pattern.test(value))) return true;
  // URL はパスやクエリに英数字が混ざるだけで、鍵とは別物として扱う。
  if (/^https?:\/\//i.test(value)) return false;
  // 空白なしで32文字以上。全部が同じ字種（数字だけ・小文字だけの記念日等）なら
  // 乱数とは言えないので、字種が3種以上混ざるものだけを鍵らしいと見る。
  if (value.length < 32 || /\s/.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/]
    .filter((pattern) => pattern.test(value)).length;
  return classes >= 3;
}

/** datetime-local は管理画面のJST入力として受け、DBでは比較可能なUTC ISOにそろえる。 */
export function normalizeCommonVarValidityAt(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (local) {
    const [, year, month, day, hour, minute] = local;
    const jstAsUtc = Date.UTC(
      Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute),
    );
    const roundTrip = new Date(jstAsUtc).toISOString().slice(0, 16);
    if (roundTrip !== value) return null;
    return new Date(jstAsUtc - 9 * 60 * 60_000).toISOString();
  }
  const at = new Date(value);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

/**
 * 実行時刻を1つに固定して、本文が参照する共通情報だけを解決する。
 *
 * 有効期間は [valid_from, valid_until) の半開区間。終了時刻ちょうどは
 * 期限切れとして扱う。呼び出し側は entries の id/version をsnapshotと一緒に
 * 保存し、外部送信前に同じ版かをCAS確認する。
 */
export async function resolveCommonVarValuesAt(
  db: D1Database,
  lineAccountId: string,
  varKeys: string[],
  executionAt: string,
): Promise<CommonVarResolution> {
  const uniqueKeys = [...new Set(varKeys)];
  if (uniqueKeys.length === 0) return { ok: true, values: {}, entries: [] };
  const executionMs = Date.parse(executionAt);
  if (!Number.isFinite(executionMs)) {
    return {
      ok: false,
      failures: uniqueKeys.map((varKey) => ({ varKey, reason: 'invalid_window' })),
    };
  }
  const rows = await db.prepare(
    `SELECT id, var_key, value, fallback_value, valid_from, valid_until,
            expiry_behavior, version, status
       FROM common_vars
      WHERE line_account_id = ? AND archived_at IS NULL`,
  ).bind(lineAccountId).all<Pick<
    CommonVar,
    'id' | 'var_key' | 'value' | 'fallback_value' | 'valid_from' | 'valid_until' | 'expiry_behavior' | 'version' | 'status'
  >>();
  const byKey = new Map(rows.results.map((row) => [row.var_key, row]));
  const values: Record<string, string> = {};
  const entries: CommonVarResolutionEntry[] = [];
  const failures: Array<{ varKey: string; reason: CommonVarResolutionFailureReason }> = [];

  for (const varKey of uniqueKeys) {
    const row = byKey.get(varKey);
    if (!row) {
      failures.push({ varKey, reason: 'missing' });
      continue;
    }
    // 止めた・下書きは差し込みに答えられない。代替値も使わず、
    // 配信を止めて運用者へ知らせる失敗にする（Q）。
    if (row.status === 'stopped' || row.status === 'draft') {
      failures.push({ varKey, reason: row.status });
      continue;
    }
    const fromMs = row.valid_from === null ? null : Date.parse(row.valid_from);
    const untilMs = row.valid_until === null ? null : Date.parse(row.valid_until);
    const invalidWindow = (fromMs !== null && !Number.isFinite(fromMs))
      || (untilMs !== null && !Number.isFinite(untilMs))
      || (fromMs !== null && untilMs !== null && fromMs >= untilMs);
    const before = !invalidWindow && fromMs !== null && executionMs < fromMs;
    const expired = !invalidWindow && untilMs !== null && executionMs >= untilMs;
    if (!invalidWindow && !before && !expired) {
      // 制約導入前の旧行は value が NULL で残り得る。NULL を値として返すと
      // 呼出し側の `vars[key] ?? ''` で空文字化して送られるため、
      // 文字列でない値は missing 相当の失敗に倒す。
      if (typeof row.value !== 'string' || (['store_phone','reservation_url'].includes(varKey) && !row.value.trim())) {
        failures.push({ varKey, reason: 'missing' });
        continue;
      }
      values[varKey] = row.value;
      entries.push({
        id: row.id,
        varKey,
        version: Number(row.version),
        value: row.value,
        source: 'primary',
      });
      continue;
    }
    if (row.expiry_behavior === 'fallback' && typeof row.fallback_value === 'string' && (!['store_phone','reservation_url'].includes(varKey) || !!row.fallback_value.trim())) {
      values[varKey] = row.fallback_value;
      entries.push({
        id: row.id,
        varKey,
        version: Number(row.version),
        value: row.fallback_value,
        source: 'fallback',
      });
      continue;
    }
    failures.push({
      varKey,
      reason: invalidWindow
        ? 'invalid_window'
        : row.expiry_behavior === 'fallback'
          ? 'fallback_missing'
          : before ? 'not_started' : 'expired',
    });
  }
  return failures.length > 0 ? { ok: false, failures } : { ok: true, values, entries };
}
