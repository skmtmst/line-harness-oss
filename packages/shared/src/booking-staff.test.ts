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
    [{ name: '担当', display_name: '表示', photo_media_id: 123 }, '写真は登録メディアから選んでください'],
  ])('不正な型を拒否する', (body, error) => {
    expect(parseBookingStaffInput(body, 'create')).toMatchObject({ ok: false, error });
  });

  test('写真は送られたときだけ値に入り、送らなければ触らない', () => {
    expect(parseBookingStaffInput({
      name: '担当', display_name: '表示', photo_media_id: '  photo-1  ',
    }, 'create')).toMatchObject({ ok: true, value: { photo_media_id: 'photo-1' } });
    expect(parseBookingStaffInput({
      name: '担当', display_name: '表示', photo_media_id: null,
    }, 'update')).toMatchObject({ ok: true, value: { photo_media_id: null } });
    expect(parseBookingStaffInput({
      name: '担当', display_name: '表示',
    }, 'update')).toMatchObject({ ok: true, value: {} });
  });
});
