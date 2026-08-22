import { describe, expect, it } from 'vitest';
import {
  chooseRestaurantTable,
  isRestaurantReservationSource,
  restaurantRoleFromAdminRole,
  validateInboundReservation,
} from './restaurant-test.js';

describe('飲食店向け予約の受信専用境界', () => {
  it('許可した予約元だけを受け付ける', () => {
    expect(isRestaurantReservationSource('restaurant_board')).toBe(true);
    expect(isRestaurantReservationSource('hotpepper')).toBe(true);
    expect(isRestaurantReservationSource('outbound')).toBe(false);
  });

  it('外部IDと正しい時間範囲を必須にする', () => {
    expect(validateInboundReservation({
      externalId: 'RB-100', customerName: '山田様', guestCount: 2,
      startsAt: '2026-08-21T09:00:00.000Z', endsAt: '2026-08-21T11:00:00.000Z',
    }).ok).toBe(true);
    expect(validateInboundReservation({
      externalId: '', customerName: '山田様', guestCount: 2,
      startsAt: '2026-08-21T11:00:00.000Z', endsAt: '2026-08-21T09:00:00.000Z',
    }).ok).toBe(false);
  });

  it('人数に最も無駄の少ない卓を優先する', () => {
    expect(chooseRestaurantTable([
      { id: 'large', minCapacity: 1, maxCapacity: 8, isActive: true },
      { id: 'best', minCapacity: 1, maxCapacity: 2, isActive: true },
      { id: 'off', minCapacity: 1, maxCapacity: 2, isActive: false },
    ], 2)).toBe('best');
  });

  it('既存管理権限を飲食店向けRBACへ縮小写像する', () => {
    expect(restaurantRoleFromAdminRole('owner')).toBe('super_admin');
    expect(restaurantRoleFromAdminRole('admin')).toBe('store_manager');
    expect(restaurantRoleFromAdminRole('viewer')).toBe('staff');
  });
});
