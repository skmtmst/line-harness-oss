


/**
 * 共通情報。
 *
 * 営業時間や電話番号のように、いくつものテンプレートに同じ文字が
 * 散らばるものを1か所にまとめる。変えるときに全テンプレートを
 * 探して回らなくてよくなる。
 */

export const COMMON_VAR_TYPES = ['text', 'url', 'image', 'number', 'long_text', 'date', 'datetime', 'boolean'] as const;
export type CommonVarType = (typeof COMMON_VAR_TYPES)[number];

export type CommonVarResolutionFailureReason =
  | 'missing'
  | 'not_started'
  | 'expired'
  | 'fallback_missing'
  | 'invalid_window'
  | 'stopped'
  | 'draft';

export interface CommonVarResolutionEntry {
  id: string;
  varKey: string;
  version: number;
  value: string;
  source: 'primary' | 'fallback';
}

export type CommonVarResolution =
  | { ok: true; values: Record<string, string>; entries: CommonVarResolutionEntry[] }
  | { ok: false; failures: Array<{ varKey: string; reason: CommonVarResolutionFailureReason }> };
