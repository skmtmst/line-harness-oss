/**
 * DB が保持する dog / cat / other を、表示・印刷・計算で同じ意味のまま扱う。その他の動物を犬として計算しないよう、種別判定を共有する。
 */

export type PetAnimalType = 'dog' | 'cat' | 'other';

/**
 * DBの animal_type を表示・判定用の種別へ正規化する。
 * 'other' はそのまま 'other'。犬・猫・その他以外の（CHECK上あり得ない）
 * 値は、見知らぬ値を犬として扱わないよう 'other' 側へ倒す。
 */
export function toPetAnimalType(raw: unknown): PetAnimalType {
  return raw === 'dog' ? 'dog' : raw === 'cat' ? 'cat' : 'other';
}

/**
 * NRC／FEDIAF の給与計算は犬・猫だけが対象。「その他」に犬の係数で
 * 計算した数値を出さないための判定。
 */
export function isFeedingSupportedAnimal(type: PetAnimalType): type is 'dog' | 'cat' {
  return type === 'dog' || type === 'cat';
}

/** 表示用の種別名。管理画面・LIFF・ペットカードで同じ語を使う。 */
export const PET_ANIMAL_TYPE_LABELS: Record<PetAnimalType, string> = {
  dog: '犬',
  cat: '猫',
  other: 'その他',
};

export function petAnimalTypeLabel(raw: unknown): string {
  return PET_ANIMAL_TYPE_LABELS[toPetAnimalType(raw)];
}
