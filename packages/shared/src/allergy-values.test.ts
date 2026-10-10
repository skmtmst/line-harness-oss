import { expect, test } from 'vitest';
import { allergyValues, BASIC_FRIEND_FIELDS, DEFAULT_ALLERGY_OPTIONS, validateAllergyValues } from './fixed-friend-fields';
import { diningSnapshot } from './reservation-board';
test('旧文字・JSON・複数の自由記入を読み、重複を外す', () => {
  expect(allergyValues('卵、乳')).toEqual(['卵、乳']);
  expect(allergyValues('["卵","乳","卵"," キウイ "]')).toEqual(['卵','乳','キウイ']);
  expect(validateAllergyValues(['卵','キウイ'])).toEqual({ok:true,values:['卵','キウイ']});
  expect(BASIC_FRIEND_FIELDS.map(field=>field.key)).toEqual(['name','kana','birthday','age','email','tel','address','allergy']);
  expect(DEFAULT_ALLERGY_OPTIONS).toHaveLength(8);
});
test.each([{}, ['卵', 1], ['x'.repeat(101)], Array(33).fill('卵'), '[壊れたJSON'])('不正な配列を保存しない: %j', raw => {
  expect(validateAllergyValues(raw).ok).toBe(false);
});
test('予約時の写しはJSON配列を読める文字にし、他の情報は保つ', () => {
  const raw=JSON.stringify({allergy:'["卵","乳"]',anniversary:'2026-10-11',seatPreference:'窓側',capturedAt:'2026-10-11'});
  expect(diningSnapshot(raw)).toMatchObject({allergy:'卵・乳',seatPreference:'窓側'});
  expect(JSON.parse(raw).allergy).toBe('["卵","乳"]');
});
