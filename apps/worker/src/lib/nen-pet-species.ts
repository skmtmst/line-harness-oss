/**
 * ペットの動物種別の共通定義（監査 DEEP-24）。
 *
 * DB（nen_pet_profiles.animal_type）は CHECK で 'dog' | 'cat' | 'other' に
 * 限定されている。以前は API や主食計算が `=== 'cat' ? 'cat' : 'dog'` と
 * 書いていて、「その他」が犬に変換されて表示・印刷・計算されていた。
 * ここで1本にそろえ、other は other のまま保持する。
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
