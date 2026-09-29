import { describe, expect, it } from 'vitest';
import { FEATURE_CATALOG, FEATURE_IDS, assertValidFeatureCatalog } from './feature-catalog.js';

const REMOVED_GHOST_FEATURE_IDS = [
  'reservation_ledger',
  'multi_store_bulk_updates',
  'external_reservations',
  'google_business_profile',
] as const;

describe('feature catalog dependencies', () => {
  it('正本カタログの依存先は存在し、循環しない', () => {
    expect(() => assertValidFeatureCatalog(FEATURE_CATALOG)).not.toThrow();
  });

  it('予約はbookingの1キーに一本化し、未実装の幽霊キーを公開しない', () => {
    expect(FEATURE_IDS.filter((featureId) => featureId === 'booking')).toEqual(['booking']);
    expect(FEATURE_IDS).not.toEqual(expect.arrayContaining([...REMOVED_GHOST_FEATURE_IDS]));
    expect(FEATURE_CATALOG.flatMap(({ dependencies }) => dependencies))
      .not.toEqual(expect.arrayContaining([...REMOVED_GHOST_FEATURE_IDS]));
  });

  it('存在しない機能IDへの依存を拒否する', () => {
    expect(() => assertValidFeatureCatalog([
      { featureId: 'child', dependencies: ['missing'] },
    ])).toThrow(/存在しない依存先.*missing/);
  });

  it('直接・間接の循環依存を拒否する', () => {
    expect(() => assertValidFeatureCatalog([
      { featureId: 'a', dependencies: ['b'] },
      { featureId: 'b', dependencies: ['c'] },
      { featureId: 'c', dependencies: ['a'] },
    ])).toThrow(/循環依存.*a.*b.*c.*a/);
  });
});
