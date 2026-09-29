import { describe, expect, it } from 'vitest';
import { isFeedingSupportedAnimal, petAnimalTypeLabel, toPetAnimalType } from './nen-pet-species.js';

describe('ペットの動物種別（DEEP-24）', () => {
  it('その他は「その他」のまま保持し、犬へ変換しない', () => {
    expect(toPetAnimalType('dog')).toBe('dog');
    expect(toPetAnimalType('cat')).toBe('cat');
    expect(toPetAnimalType('other')).toBe('other');
  });

  it('見知らぬ値を犬として扱わない', () => {
    expect(toPetAnimalType('rabbit')).toBe('other');
    expect(toPetAnimalType('')).toBe('other');
    expect(toPetAnimalType(null)).toBe('other');
    expect(toPetAnimalType(undefined)).toBe('other');
  });

  it('給与計算（NRC／FEDIAF）の対象は犬・猫だけ', () => {
    expect(isFeedingSupportedAnimal('dog')).toBe(true);
    expect(isFeedingSupportedAnimal('cat')).toBe(true);
    expect(isFeedingSupportedAnimal('other')).toBe(false);
  });

  it('表示名は 犬・猫・その他。other を犬と表示しない', () => {
    expect(petAnimalTypeLabel('dog')).toBe('犬');
    expect(petAnimalTypeLabel('cat')).toBe('猫');
    expect(petAnimalTypeLabel('other')).toBe('その他');
    expect(petAnimalTypeLabel('rabbit')).toBe('その他');
  });
});
