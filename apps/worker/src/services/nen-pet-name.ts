/**
 * 男の子はくん、女の子・未回答はちゃんを付ける。名前の末尾にすでにある場合は敬称を重ねない。
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
