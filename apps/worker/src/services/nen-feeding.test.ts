/*
 * マイペットの給与量（★V6 37-2「今日の目安」）。NRC／FEDIAF の式を固定する。
 *  RER = 70 × 体重^0.75、MER = RER × 係数、g = MER ÷ 主食の kcal/100g × 100
 */
import { describe, expect, it } from 'vitest';
import {
  ageInMonths, energyFactor, feedingPlan, gramsFor, lifeStageFor, neuteredFromInput, neuteredFromRow,
  pickProduct, pickTreat, restingEnergyKcal, validateFeedingProducts, validateTreatLimitPercent, venisonPlan,
  type FeedingProductRow,
} from './nen-feeding.js';

const today = new Date('2026-09-16T00:00:00Z');
const venison = { id: 'p1', name: '鹿肉ミンチ', kcalPer100g: 120 };

describe('RER / MER', () => {
  it('RER = 70 × kg^0.75（10kg → 394kcal、5kg → 234kcal）', () => {
    expect(restingEnergyKcal(10)).toBe(394);
    expect(restingEnergyKcal(5)).toBe(234);
    expect(restingEnergyKcal(4.2)).toBe(205);
  });

  it('成犬・避妊去勢済み・ふつう は 1.6、未去勢は 1.8、運動量で ±0.2', () => {
    expect(energyFactor({ animalType: 'dog', stage: 'adult', ageMonths: 36, neutered: true, activityLevel: 'normal' })).toEqual({ factor: 1.6, label: '成犬・避妊去勢済み' });
    expect(energyFactor({ animalType: 'dog', stage: 'adult', ageMonths: 36, neutered: false, activityLevel: 'normal' })).toEqual({ factor: 1.8, label: '成犬' });
    expect(energyFactor({ animalType: 'dog', stage: 'adult', ageMonths: 36, neutered: true, activityLevel: 'high' }).factor).toBe(1.8);
    expect(energyFactor({ animalType: 'dog', stage: 'adult', ageMonths: 36, neutered: false, activityLevel: 'low' }).factor).toBe(1.6);
    expect(energyFactor({ animalType: 'dog', stage: 'adult', ageMonths: 36, neutered: null, activityLevel: 'normal' }).factor).toBe(1.6);
  });

  it('子犬は 4か月未満 3.0、12か月未満 2.0 で活動量を見ない。シニアは 1.4／1.6', () => {
    expect(energyFactor({ animalType: 'dog', stage: 'young', ageMonths: 3, neutered: null, activityLevel: 'high' }).factor).toBe(3.0);
    expect(energyFactor({ animalType: 'dog', stage: 'young', ageMonths: 8, neutered: null, activityLevel: 'high' }).factor).toBe(2.0);
    expect(energyFactor({ animalType: 'dog', stage: 'senior', ageMonths: 100, neutered: true, activityLevel: 'normal' }).factor).toBe(1.4);
    expect(energyFactor({ animalType: 'dog', stage: 'senior', ageMonths: 100, neutered: false, activityLevel: 'normal' }).factor).toBe(1.6);
  });

  it('猫は 成猫 1.2／1.4、子猫 2.5、シニア 1.1／1.3、活動量で ±0.1', () => {
    expect(energyFactor({ animalType: 'cat', stage: 'adult', ageMonths: 40, neutered: true, activityLevel: 'normal' }).factor).toBe(1.2);
    expect(energyFactor({ animalType: 'cat', stage: 'adult', ageMonths: 40, neutered: false, activityLevel: 'high' }).factor).toBe(1.5);
    expect(energyFactor({ animalType: 'cat', stage: 'young', ageMonths: 6, neutered: null, activityLevel: 'normal' }).factor).toBe(2.5);
    expect(energyFactor({ animalType: 'cat', stage: 'senior', ageMonths: 140, neutered: true, activityLevel: 'low' }).factor).toBe(1.0);
  });
});

describe('年齢区分', () => {
  it('誕生日から月齢を出し、犬は 7歳〜、猫は 11歳〜 をシニアにする', () => {
    expect(ageInMonths('2026-06-20', today)).toBe(2);
    expect(ageInMonths('2019-09-16', today)).toBe(84);
    expect(ageInMonths('2019-09-17', today)).toBe(83);
    expect(ageInMonths(null, today)).toBeNull();
    expect(ageInMonths('not-a-date', today)).toBeNull();
    expect(lifeStageFor('dog', 11)).toBe('young');
    expect(lifeStageFor('dog', 84)).toBe('senior');
    expect(lifeStageFor('cat', 84)).toBe('adult');
    expect(lifeStageFor('cat', 132)).toBe('senior');
    expect(lifeStageFor('dog', null)).toBe('adult');
  });
});

describe('feedingPlan', () => {
  it('10kg の成犬（避妊去勢済み）× 鹿肉 120kcal/100g → 630kcal ≒ 525g/日', () => {
    const plan = feedingPlan({ animalType: 'dog', weightKg: 10, birthday: '2022-04-01', neutered: true, activityLevel: 'normal' }, venison, today);
    expect(plan).toMatchObject({ stage: 'adult', stageLabel: '成犬', factor: 1.6, rerKcal: 394, dailyKcal: 630, dailyGrams: 525, minGrams: 473, maxGrams: 578 });
    expect(plan.product).toEqual(venison);
  });

  it('主食が無いときは kcal だけ返す（グラムは null）', () => {
    const plan = feedingPlan({ animalType: 'dog', weightKg: 10, birthday: null, neutered: null, activityLevel: 'normal' }, null, today);
    expect(plan.dailyKcal).toBe(630);
    expect(plan.dailyGrams).toBeNull();
    expect(plan.minGrams).toBeNull();
    expect(plan.product).toBeNull();
  });

  it('子犬は係数が大きく、同じ体重でも目安が増える', () => {
    const puppy = feedingPlan({ animalType: 'dog', weightKg: 4, birthday: '2026-06-20', neutered: null, activityLevel: 'normal' }, venison, today);
    const adult = feedingPlan({ animalType: 'dog', weightKg: 4, birthday: '2020-06-20', neutered: null, activityLevel: 'normal' }, venison, today);
    expect(puppy.stage).toBe('young');
    expect(puppy.factor).toBe(3.0);
    expect(puppy.dailyKcal).toBeGreaterThan(adult.dailyKcal * 1.8);
  });

  it('体重は小数1桁に丸める', () => {
    expect(feedingPlan({ animalType: 'cat', weightKg: 4.26, birthday: null, neutered: true, activityLevel: 'normal' }, venison, today).weightKg).toBe(4.3);
  });

  it('グラムは 1 以上', () => {
    expect(gramsFor(5, 1000)).toBe(1);
  });
});

describe('入力の解釈', () => {
  it('避妊去勢は 1/0/NULL と yes/no/unknown を行き来できる', () => {
    expect(neuteredFromRow(1)).toBe(true);
    expect(neuteredFromRow(0)).toBe(false);
    expect(neuteredFromRow(null)).toBeNull();
    expect(neuteredFromInput('yes')).toBe(true);
    expect(neuteredFromInput('no')).toBe(false);
    expect(neuteredFromInput('unknown')).toBeNull();
    expect(neuteredFromInput('maybe')).toBeUndefined();
  });

  it('主食は ペットの選択 → 既定 → 先頭 の順に選ぶ', () => {
    const rows: FeedingProductRow[] = [
      { id: 'a', line_account_id: 'x', name: 'A', kcal_per_100g: 100, is_default: 0, sort_order: 0, kind: 'staple', created_at: '', updated_at: '' },
      { id: 'b', line_account_id: 'x', name: 'B', kcal_per_100g: 200, is_default: 1, sort_order: 1, kind: 'staple', created_at: '', updated_at: '' },
      { id: 'n', line_account_id: 'x', name: '然 鹿肉ジャーキー', kcal_per_100g: 300, is_default: 1, sort_order: 2, kind: 'nen', created_at: '', updated_at: '' },
    ];
    expect(pickProduct(rows, 'a')?.name).toBe('A');
    expect(pickProduct(rows, 'missing')?.name).toBe('B');
    expect(pickProduct(rows, null)?.name).toBe('B');
    expect(pickProduct([rows[0]], null)?.name).toBe('A');
    expect(pickProduct([], null)).toBeNull();
    // 然の商品は主食として選ばれない。おやつ（目安に使う）としてだけ選ばれる
    expect(pickProduct(rows, 'n')?.name).toBe('B');
    expect(pickTreat(rows)?.name).toBe('然 鹿肉ジャーキー');
    expect(pickTreat(rows.slice(0, 2))).toBeNull();
  });

  it('然の鹿肉（おやつ）の目安：必要カロリー × 上限% ÷ 然商品の kcal/100g × 100', () => {
    // 10kg 成犬・避妊去勢済み → 630kcal。10% = 63kcal → 300kcal/100g のジャーキーで 21g
    const plan = feedingPlan({ animalType: 'dog', weightKg: 10, birthday: '2022-04-01', neutered: true, activityLevel: 'normal' }, { id: 's', name: 'ドライ', kcalPer100g: 360 }, new Date('2026-09-18T00:00:00Z'), { id: 'n', name: '然 鹿肉ジャーキー', kcalPer100g: 300 }, 10);
    expect(plan.dailyKcal).toBe(630);
    expect(plan.dailyGrams).toBe(175);
    expect(plan.venison).toEqual({ limitPercent: 10, kcal: 63, grams: 21, product: { id: 'n', name: '然 鹿肉ジャーキー', kcalPer100g: 300 } });
    // 然の商品が無ければ kcal だけ
    expect(venisonPlan(630, null, 15)).toEqual({ limitPercent: 15, kcal: 95, grams: null, product: null });
    expect(validateTreatLimitPercent(undefined)).toBe(10);
    expect(validateTreatLimitPercent('12')).toBe(12);
    expect(() => validateTreatLimitPercent(0)).toThrow('上限');
    expect(() => validateTreatLimitPercent(31)).toThrow('上限');
  });

  it('主食の一覧を検証する（名前・kcal・重複・既定は1つ）', () => {
    expect(validateFeedingProducts([{ name: '鹿肉ミンチ', kcalPer100g: 120.26 }])).toEqual([{ id: null, name: '鹿肉ミンチ', kcalPer100g: 120.3, isDefault: true, kind: 'staple' }]);
    // 主食と然の商品は、それぞれの種類で既定を1つ持つ
    expect(validateFeedingProducts([{ name: 'ドライ', kcalPer100g: 360 }, { name: '然 ジャーキー', kcalPer100g: 300, kind: 'nen' }]).map((p) => [p.kind, p.isDefault])).toEqual([['staple', true], ['nen', true]]);
    expect(() => validateFeedingProducts([{ name: 'A', kcalPer100g: 100, kind: 'nen', isDefault: true }, { name: 'B', kcalPer100g: 200, kind: 'nen', isDefault: true }])).toThrow('然の商品');
    expect(() => validateFeedingProducts([{ name: '', kcalPer100g: 120 }])).toThrow('商品名');
    expect(() => validateFeedingProducts([{ name: 'A', kcalPer100g: 0 }])).toThrow('カロリー');
    expect(() => validateFeedingProducts([{ name: 'A', kcalPer100g: 100 }, { name: 'A', kcalPer100g: 200 }])).toThrow('同じ商品名');
    expect(() => validateFeedingProducts([{ name: 'A', kcalPer100g: 100, isDefault: true }, { name: 'B', kcalPer100g: 200, isDefault: true }])).toThrow('既定');
    expect(() => validateFeedingProducts(Array.from({ length: 21 }, (_, i) => ({ name: `P${i}`, kcalPer100g: 100 })))).toThrow('20件');
    expect(validateFeedingProducts([])).toEqual([]);
  });
});
