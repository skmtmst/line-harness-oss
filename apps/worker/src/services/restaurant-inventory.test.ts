import { describe, expect, it } from 'vitest';
import { validateRestaurantOpeningHours } from './restaurant-inventory.js';

const week = () => Array.from({ length: 7 }, (_, weekday) => ({ weekday, periods: [] as Array<{ opensAt: string; closesAt: string }> }));

describe('週の営業時間の検査', () => {
  it('休業日・複数の時間帯・翌朝の閉店を保存できる', () => {
    const hours = week();
    hours[1].periods = [{ opensAt: '17:00', closesAt: '02:00' }, { opensAt: '11:00', closesAt: '14:00' }];
    expect(validateRestaurantOpeningHours(hours)?.[1].periods[0].opensAt).toBe('11:00');
  });
  it('曜日の重複、不正な時刻、曜日をまたぐ重なりを拒否する', () => {
    const hours = week();
    hours[6].periods = [{ opensAt: '23:00', closesAt: '02:00' }];
    hours[0].periods = [{ opensAt: '01:00', closesAt: '03:00' }];
    expect(validateRestaurantOpeningHours(hours)).toBeNull();
    hours[0].periods = [{ opensAt: '02:00', closesAt: '03:00' }];
    expect(validateRestaurantOpeningHours(hours)).not.toBeNull();
    hours[1].periods = [{ opensAt: '25:00', closesAt: '26:00' }];
    expect(validateRestaurantOpeningHours(hours)).toBeNull();
    const duplicate = week();
    duplicate[6].weekday = 0;
    expect(validateRestaurantOpeningHours(duplicate)).toBeNull();
  });
});
