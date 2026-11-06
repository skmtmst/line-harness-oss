import { expect, test } from 'vitest';
import { staffBookingPrice, staffNominationFee } from './booking-price.js';
test('指名料は担当別価格との差から推測せず、APIの設定額を加える', () => {
  const named = { price: 5000, nomination_fee: 500, is_designation_optional: 0 };
  expect(staffNominationFee(named)).toBe(500);
  expect(staffBookingPrice(named)).toBe(5500);
  expect(staffBookingPrice({ ...named, price: 6500 })).toBe(7000);
  expect(staffBookingPrice({ ...named, is_designation_optional: 1 })).toBe(5000);
  expect(staffBookingPrice({ price: 6500, is_designation_optional: 0 })).toBe(6500);
});
