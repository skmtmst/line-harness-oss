import { describe, expect, it } from 'vitest';
import type { MenuItem, StaffItem } from './api.js';
import { designationFee, initialParty, menuLine, partyCapable, resize, sameStaffSequence, totals } from './party.js';

const menu: MenuItem = {
  id: 'm1', name: 'トリミング（小型犬）', category_label: null, description: null, duration_minutes: 105, buffer_after_minutes: 15, base_price: 8400, sort_order: 1,
  max_party_size: 3, addons: [{ id: 'a1', name: '歯みがき', duration_minutes: 15, price: 800 }, { id: 'a2', name: '爪切り', duration_minutes: 10, price: 500 }],
};
const any: StaffItem = { id: 's0', display_name: '指名なし', role: null, profile_image_url: null, bio: null, is_designation_optional: 1, price: 8400, duration_minutes: 105 };
const sasaki: StaffItem = { id: 's1', display_name: '佐々木', role: 'トリマー', profile_image_url: null, bio: null, is_designation_optional: 0, price: 8400, nomination_fee: 500, duration_minutes: 105 };

describe('同伴・複数メニュー（B5）の合計', () => {
  it('人数の段を出すのは、メニューが人数か追加メニューを許したときだけ（上限 1・追加なしは今までどおり）', () => {
    expect(partyCapable(menu)).toBe(true);
    expect(partyCapable({ ...menu, max_party_size: 1, addons: [] })).toBe(false);
    expect(partyCapable(null)).toBe(false);
  });

  it('2 人・1 人目は歯みがき追加：合計 ¥17,600・同時に 120 分（絵 hhUtj）', () => {
    const party = resize(initialParty(), 2);
    party.members[0] = { ...party.members[0], addonIds: ['a1'] };
    const sum = totals(party, menu);
    expect(sum.rows.map((r) => r.price)).toEqual([9200, 8400]);
    expect(sum.minutes).toBe(120);
    expect(sum.price).toBe(17600);
    expect(menuLine(sum.rows[0].menu, sum.rows[0].member)).toBe('トリミング（小型犬）＋歯みがき');
  });

  it('指名なしは指名料なし、指名は設定された指名料（佐々木 +¥500）で合計は ¥18,100（絵 zYErQ）', () => {
    const party = resize(initialParty(), 2);
    party.members[0] = { ...party.members[0], addonIds: ['a1'], staff: sasaki, designated: true };
    party.members[1] = { ...party.members[1], staff: any };
    expect(designationFee(menu, party.members[0])).toBe(500);
    expect(designationFee(menu, party.members[1])).toBe(0);
    expect(totals(party, menu).price).toBe(18100);
  });

  it('全員が同じ担当を選ぶと続けて受ける（時間が足し算）。別の担当・指名なしは同時', () => {
    const party = resize(initialParty(), 2);
    party.members[0] = { ...party.members[0], staff: sasaki, designated: true };
    party.members[1] = { ...party.members[1], staff: sasaki, designated: true };
    expect(sameStaffSequence(party)).toBe(true);
    expect(totals(party, menu).minutes).toBe(210);
    party.members[1] = { ...party.members[1], staff: any, designated: false };
    expect(sameStaffSequence(party)).toBe(false);
    expect(totals(party, menu).minutes).toBe(105);
  });
});

it('追加メニューと担当別料金・指名料・所要時間をそれぞれ加算する', () => {
  const party = initialParty();
  party.members[0] = { ...party.members[0], addonIds: ['a1'], staff: { ...sasaki, price: 9000, nomination_fee: 600, duration_minutes: 90 }, designated: true };
  expect(totals(party, menu)).toMatchObject({ price: 10400, minutes: 105 });
});
