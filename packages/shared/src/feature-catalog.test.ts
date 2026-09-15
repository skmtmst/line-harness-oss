import { describe, expect, it } from 'vitest';
import { FEATURE_CATALOG, assertValidFeatureCatalog } from './feature-catalog.js';

describe('feature catalog dependencies', () => {
  it('正本カタログの依存先は存在し、循環しない', () => {
    expect(() => assertValidFeatureCatalog(FEATURE_CATALOG)).not.toThrow();
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
