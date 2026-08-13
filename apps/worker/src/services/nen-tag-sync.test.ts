import { describe, expect, it } from 'vitest';
import { deriveEcTagIds, derivePetTagIds, NEN_TAG } from './nen-tag-sync.js';

describe('NEN automatic tag rules', () => {
  const now = new Date('2026-08-11T03:00:00Z');

  it('replaces rank and purchase-state tags from the current EC totals', () => {
    const tags = deriveEcTagIds({
      customer_id: '33',
      orders_json: JSON.stringify([{ date: '2026-08-01T10:00:00+09:00', paymentMethod: 'Stripe credit card', items: [{ name: '毎日の鹿肉バランス4袋セット' }] }]),
      subscription_json: null,
      purchase_count: 3,
      purchase_amount: 52_000,
      member_rank: 'ゴールド会員',
    }, now);

    expect(tags).toEqual(expect.objectContaining(new Set([
      NEN_TAG.rankGold,
      NEN_TAG.purchaseExperienced,
      NEN_TAG.purchaseRepeat,
      NEN_TAG.purchaseRecent30,
      NEN_TAG.purchase20k,
      NEN_TAG.purchase50k,
      NEN_TAG.paymentCard,
      NEN_TAG.productBalance,
      NEN_TAG.productSet,
    ])));
    expect(tags.has(NEN_TAG.rankSilver)).toBe(false);
    expect(tags.has(NEN_TAG.purchaseNone)).toBe(false);
  });

  it('detects subscription status and a date within seven days', () => {
    const tags = deriveEcTagIds({
      customer_id: '33', orders_json: '[]', purchase_count: 0, purchase_amount: 0,
      member_rank: '会員',
      subscription_json: JSON.stringify({ contracts: [{ status: '契約中', next_shipping_date: '2026-08-17', items: [{ name: '鹿肉ミンチ定期便' }] }] }),
    }, now);

    expect(tags.has(NEN_TAG.subscriptionActive)).toBe(true);
    expect(tags.has(NEN_TAG.subscriptionNext7d)).toBe(true);
    expect(tags.has(NEN_TAG.subscriptionNone)).toBe(false);
    expect(tags.has(NEN_TAG.productSubscription)).toBe(true);
    expect(tags.has(NEN_TAG.productMince)).toBe(true);
  });

  it('aggregates multiple pets, birthday periods, size, age and concerns', () => {
    const tags = derivePetTagIds([
      { animal_type: 'dog', birthday: '2015-08-20', weight_kg: 8, concerns: '["tear_stain","allergy"]', image_url: 'https://example.com/dog.jpg' },
      { animal_type: 'cat', birthday: '2025-09-01', weight_kg: 4, concerns: '["weight"]', image_url: null },
    ], now);

    for (const tag of [
      NEN_TAG.petRegistered, NEN_TAG.petMultiple, NEN_TAG.petDog, NEN_TAG.petCat,
      NEN_TAG.petDogAndCat, NEN_TAG.petSmallDog, NEN_TAG.petSenior,
      NEN_TAG.petBirthdayThisMonth, NEN_TAG.petBirthdayNextMonth, NEN_TAG.petPhoto,
      NEN_TAG.concernTear, NEN_TAG.concernAllergy, NEN_TAG.concernWeight,
    ]) expect(tags.has(tag)).toBe(true);
    expect(tags.has(NEN_TAG.petUnregistered)).toBe(false);
  });

  it('marks a user with no pets as unregistered', () => {
    expect(derivePetTagIds([], now)).toEqual(new Set([NEN_TAG.petUnregistered]));
  });
});
