import { describe, expect, it } from 'vitest';
import {
  LINE_TOKEN_NOTICE_EVENT_TYPES,
  isSystemNotification,
  notificationCenterQueryForTab,
} from './notification-center.js';

describe('通知のタブと種類', () => {
  it('未読は口で絞り、システムは運用の異常だけを読む', () => {
    expect(notificationCenterQueryForTab('all')).toEqual({});
    expect(notificationCenterQueryForTab('unread')).toEqual({ unread: '1' });
    expect(notificationCenterQueryForTab('system')).toEqual({ category: 'error' });
  });

  it('鍵の知らせと運用の異常はシステム、アップデートとお知らせは入れない', () => {
    for (const eventType of LINE_TOKEN_NOTICE_EVENT_TYPES) {
      expect(isSystemNotification({ category: 'info', eventType })).toBe(true);
    }
    expect(isSystemNotification({ category: 'error', eventType: 'operation_alert' })).toBe(true);
    expect(isSystemNotification({ category: 'update', eventType: 'release' })).toBe(false);
    expect(isSystemNotification({ category: 'info', eventType: 'store_comparison_export' })).toBe(false);
  });
});
