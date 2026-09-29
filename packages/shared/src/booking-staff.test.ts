import { describe, expect, test } from 'vitest';
import { parseBookingStaffInput } from './booking-staff';

describe('予約スタッフ共通入力schema', () => {
  test('booleanと従来の0/1を同じ保存値へ正規化する', () => {
    expect(parseBookingStaffInput({
      name: '担当', display_name: '表示',
      is_designation_optional: true, is_active: 0,
    }, 'create')).toMatchObject({
      ok: true,
      value: { is_designation_optional: 1, is_active: 0 },
    });
  });

  test.each([
    [{ name: 1 }, 'スタッフ名は文字で入力してください'],
    [{ name: '担当', display_name: [] }, '表示名は文字で入力してください'],
    [{ name: '担当', display_name: '表示', is_active: 'yes' }, '有効状態はオン・オフで指定してください'],
  ])('不正な型を拒否する', (body, error) => {
    expect(parseBookingStaffInput(body, 'create')).toMatchObject({ ok: false, error });
  });
});
