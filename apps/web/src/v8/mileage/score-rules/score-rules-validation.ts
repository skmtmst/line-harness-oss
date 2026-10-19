/*
 * スコアのルール画面の入力検証（R302・R303）。
 *
 * 試算前の点数もルールの表示名も、空欄のまま進めると「できたつもり」に
 * なる。欄の下で理由を示し、空欄と空白だけは受け付けない。
 * 明示した 0（点数）・0文字でない名前は通す。
 */

export type ScoreValidation = { ok: true; value: number } | { ok: false; error: string }

function rangeMessage(bands: { min: number; max: number }): string {
  return `テストする点数は${bands.min}〜${bands.max}の整数で入力してください`
}

/**
 * 試算前の点数。空欄・空白だけは必須エラーにする。
 * 空文字を `Number()` に通すと 0 になって入力忘れを見逃すため（R302）、
 * 数値化する前に文字で確かめる。101・1.5 などの範囲外・小数は
 * 従来どおり範囲の文で落とす。
 */
export function validateTestScore(
  raw: string,
  bands: { min: number; max: number },
): ScoreValidation {
  const text = raw.trim()
  if (!text) return { ok: false, error: 'テストする点数を入力してください' }
  if (!/^-?\d+$/.test(text)) return { ok: false, error: rangeMessage(bands) }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < bands.min || value > bands.max) {
    return { ok: false, error: rangeMessage(bands) }
  }
  return { ok: true, value }
}

export type NameValidation = { ok: true; value: string } | { ok: false; error: string }

/**
 * ルールの表示名。空欄・空白だけでは一覧へ追加しない（R303）。
 * 前後の空白は落として返す。
 */
export function validateRuleName(raw: string): NameValidation {
  const value = raw.trim()
  if (!value) return { ok: false, error: '表示名を入力してください' }
  return { ok: true, value }
}
