import { describe, expect, test } from 'vitest';
import { bookingHistoryItem } from './booking-history-item.js';

describe('booking history menu name', () => {
  test.each(['', '{broken', 'null', '[]', '{"name":5}', '{"name":" "}'])('damaged or unusable snapshots keep the current name: %s', (saved) => {
    expect(bookingHistoryItem({ id: 'booking', menu_name: 'current', menu_snapshot_json: saved })).toEqual({ id: 'booking', menu_name: 'current' });
  });
  test('uses the saved name without exposing or changing the snapshot', () => {
    const row = { id: 'booking', menu_name: 'current', menu_snapshot_json: '{"name":"at booking"}' };
    expect(bookingHistoryItem(row)).toEqual({ id: 'booking', menu_name: 'at booking' });
    expect(row.menu_name).toBe('current');
  });
});
