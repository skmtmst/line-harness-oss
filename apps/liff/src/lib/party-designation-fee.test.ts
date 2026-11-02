import { expect, it } from 'vitest';
import type { MenuItem, StaffItem } from './api.js';
import { designationFee, initialParty, resize, totals } from './party.js';

const menu: MenuItem = { id: 'menu', name: '施術', category_label: null, description: null, duration_minutes: 60, buffer_after_minutes: 0, base_price: 8400, sort_order: 0 };
const staff: StaffItem = { id: 'staff', display_name: '担当', role: null, bio: null, profile_image_url: null, is_designation_optional: 0, price: 9000, duration_minutes: 75, nomination_fee: 1000 };

it.each([[false, false, 18000], [true, false, 19000], [true, true, 20000]] as const)('人ごとの指名状態 %s/%s で指名料だけを足す', (first, second, price) => {
  const party = resize(initialParty(), 2);
  party.members = party.members.map((member, index) => ({ ...member, staff, designated: index === 0 ? first : second }));
  const sum = totals(party, menu);
  expect(sum.price).toBe(price);
  expect(sum.rows.map(row => row.price)).toEqual([9000, 9000]);
  expect(sum.rows.map(row => row.minutes)).toEqual([75, 75]);
  expect(sum.minutes).toBe(150);
  expect(sum.sequential).toBe(true);
});

it.each([0, undefined])('指名料が%sでも担当別価格と時間は残す', nomination_fee => {
  const party = initialParty();
  party.members[0] = { ...party.members[0], staff: { ...staff, nomination_fee }, designated: true };
  expect(totals(party, menu)).toMatchObject({ price: 9000, minutes: 75 });
});

it('指名なしの専用行・担当なしは指名料を補わない', () => {
  const member = initialParty().members[0];
  expect(designationFee(menu, { ...member, staff: null, designated: true })).toBe(0);
  expect(designationFee(menu, { ...member, staff: { ...staff, is_designation_optional: 1 }, designated: true })).toBe(0);
  expect(designationFee(menu, { ...member, staff, designated: false })).toBe(0);
});

it('別メニューと追加の価格・時間、明示した指名料をそれぞれ保持する', () => {
  const party = resize(initialParty(), 2);
  const second: MenuItem = { ...menu, id: 'second', base_price: 5000, duration_minutes: 30, addons: [{ id: 'addon', name: '追加', price: 300, duration_minutes: 15 }] };
  party.members[0] = { ...party.members[0], staff, designated: false };
  party.members[1] = { ...party.members[1], menu: second, addonIds: ['addon'], staff: { ...staff, id: 'second-staff', price: 5500, duration_minutes: 40, nomination_fee: 500 }, designated: true };
  expect(totals(party, menu)).toMatchObject({ price: 15300, minutes: 75, sequential: false });
  expect(totals(party, menu).rows.map(row => ({ price: row.price, minutes: row.minutes, fee: row.fee }))).toEqual([
    { price: 9000, minutes: 75, fee: 0 }, { price: 5800, minutes: 55, fee: 500 },
  ]);
});
