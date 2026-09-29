import { describe, expect, it } from 'vitest';
import { EC_EVENT_LABELS, EC_EVENT_TYPES, ecEventLabel } from './ec-events.js';

describe('EC event shared contract', () => {
  it('受け付ける全イベントに重複のない共通表示名がある', () => {
    expect(new Set(EC_EVENT_TYPES).size).toBe(EC_EVENT_TYPES.length);
    for (const eventType of EC_EVENT_TYPES) {
      expect(EC_EVENT_LABELS[eventType].trim()).not.toBe('');
      expect(ecEventLabel(eventType)).toBe(EC_EVENT_LABELS[eventType]);
    }
  });

  it('未知のイベントは画面向けの安全な表示へ戻す', () => {
    expect(ecEventLabel('ec.unknown')).toBe('ECの出来事');
    expect(ecEventLabel('ec.subscription.started')).toBe('定期便がはじまりました');
  });
});
