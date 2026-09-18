/**
 * ペットの呼び名（★V6 37-2-A-2、2026-09-18 Masato 決定）。
 * 男の子＝「くん」、女の子＝「ちゃん」、未回答＝「ちゃん」。名前の末尾にすでに付いていれば重ねない。
 */
export type PetGender = 'male' | 'female' | 'unknown';

export function petGender(value: unknown): PetGender {
  return value === 'male' ? 'male' : value === 'female' ? 'female' : 'unknown';
}

export function petSuffix(gender: unknown): 'くん' | 'ちゃん' {
  return petGender(gender) === 'male' ? 'くん' : 'ちゃん';
}

export function petCallName(name: string, gender: unknown): string {
  const base = String(name ?? '').trim();
  if (!base) return '';
  if (/(くん|ちゃん|さん)$/.test(base)) return base;
  return `${base}${petSuffix(gender)}`;
}
