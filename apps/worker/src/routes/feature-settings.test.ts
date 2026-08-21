import { describe, expect, it } from 'vitest';
import { DEFAULT_DISABLED_FEATURES, featureIsEnabled } from './feature-settings.js';

describe('feature settings defaults', () => {
  it('V2でオフの機能は保存値が無くても無効', () => {
    expect(DEFAULT_DISABLED_FEATURES.has('webinars')).toBe(true);
    expect(featureIsEnabled(null, 'webinars')).toBe(false);
    expect(featureIsEnabled(null, 'affiliates')).toBe(false);
  });

  it('然の専用機能と通常機能は保存値が無ければ有効', () => {
    expect(featureIsEnabled(null, 'nen_campaigns')).toBe(true);
    expect(featureIsEnabled(null, 'photo_review')).toBe(true);
    expect(featureIsEnabled(null, 'scenarios')).toBe(true);
  });

  it('明示保存した値を初期値より優先する', () => {
    expect(featureIsEnabled(JSON.stringify({ enabled: true }), 'webinars')).toBe(true);
    expect(featureIsEnabled(JSON.stringify({ enabled: false }), 'scenarios')).toBe(false);
  });

  it('壊れた値はV2の安全な初期値へ戻す', () => {
    expect(featureIsEnabled('{broken', 'webinars')).toBe(false);
    expect(featureIsEnabled('{broken', 'scenarios')).toBe(true);
  });
});
