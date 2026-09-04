import { attachTagAndFireSideEffects, detachTagAndFireSideEffects } from './friend-tag-attach.js';

export const NEN_TAG = {
  member: 'nen-tag-member-nen',
  lineLinked: 'nen-tag-member-line-linked',
  ecLinked: 'nen-tag-member-ec-linked',
  rankBasic: 'nen-tag-member-rank-basic',
  rankSilver: 'nen-tag-member-rank-silver',
  rankGold: 'nen-tag-member-rank-gold',
  rankPlatinum: 'nen-tag-member-rank-platinum',
  purchaseNone: 'nen-tag-purchase-none',
  purchaseFirst: 'nen-tag-purchase-first',
  purchaseExperienced: 'nen-tag-purchase-experienced',
  purchaseRepeat: 'nen-tag-purchase-repeat',
  purchaseRecent30: 'nen-tag-purchase-recent-30',
  purchaseRecent90: 'nen-tag-purchase-recent-90',
  purchaseDormant: 'nen-tag-purchase-dormant',
  purchase20k: 'nen-tag-purchase-total-20k',
  purchase50k: 'nen-tag-purchase-total-50k',
  purchase100k: 'nen-tag-purchase-total-100k',
  paymentAmazon: 'nen-tag-payment-amazon-pay',
  paymentCard: 'nen-tag-payment-card',
  paymentBank: 'nen-tag-payment-bank',
  subscriptionNone: 'nen-tag-subscription-none',
  subscriptionActive: 'nen-tag-subscription-active',
  subscriptionPaused: 'nen-tag-subscription-paused',
  subscriptionCancelled: 'nen-tag-subscription-cancelled',
  subscriptionFailed: 'nen-tag-subscription-failed',
  subscriptionNext7d: 'nen-tag-subscription-next-7d',
  petUnregistered: 'nen-tag-pet-unregistered',
  petRegistered: 'nen-tag-pet-registered',
  petMultiple: 'nen-tag-pet-multiple',
  petDog: 'nen-tag-pet-dog',
  petCat: 'nen-tag-pet-cat',
  petDogAndCat: 'nen-tag-pet-dog-and-cat',
  petSmallDog: 'nen-tag-pet-small-dog',
  petMediumDog: 'nen-tag-pet-medium-dog',
  petLargeDog: 'nen-tag-pet-large-dog',
  petYoung: 'nen-tag-pet-young',
  petAdult: 'nen-tag-pet-adult',
  petSenior: 'nen-tag-pet-senior',
  petBirthdayThisMonth: 'nen-tag-pet-birthday-this-month',
  petBirthdayNextMonth: 'nen-tag-pet-birthday-next-month',
  petPhoto: 'nen-tag-pet-profile-photo',
  concernTear: 'nen-tag-concern-tear-stain',
  concernCoat: 'nen-tag-concern-coat',
  concernAllergy: 'nen-tag-concern-allergy',
  concernAppetite: 'nen-tag-concern-appetite',
  concernStool: 'nen-tag-concern-stool',
  concernWeight: 'nen-tag-concern-weight',
  concernOther: 'nen-tag-concern-other',
  healthDiary: 'nen-tag-health-diary',
  healthWeightLog: 'nen-tag-health-weight-log',
  healthHeartLog: 'nen-tag-health-heart-log',
  healthBreathLog: 'nen-tag-health-breath-log',
  healthAppetiteCheck: 'nen-tag-health-appetite-check',
  healthStoolCheck: 'nen-tag-health-stool-check',
  healthWeightCheck: 'nen-tag-health-weight-check',
  interestVenison: 'nen-tag-interest-venison',
  interestPetFood: 'nen-tag-interest-pet-food',
  interestHealth: 'nen-tag-interest-health',
  interestTear: 'nen-tag-interest-tear-stain',
  interestAllergy: 'nen-tag-interest-allergy',
  interestSkinCoat: 'nen-tag-interest-skin-coat',
  interestWeight: 'nen-tag-interest-weight',
  interestSenior: 'nen-tag-interest-senior',
  actionPhotoPosted: 'nen-tag-action-photo-posted',
  actionPhotoReview: 'nen-tag-action-photo-review',
  actionPhotoApproved: 'nen-tag-action-photo-approved',
  actionDiaryContinued: 'nen-tag-action-diary-continued',
  deliveryOrder: 'nen-tag-delivery-order',
  deliveryShipped: 'nen-tag-delivery-shipped',
  deliveryArrival: 'nen-tag-delivery-arrival',
  deliveryReview: 'nen-tag-delivery-review',
  deliveryRecommendation: 'nen-tag-delivery-recommendation',
  deliveryColumn: 'nen-tag-delivery-column',
  deliveryBirthday: 'nen-tag-delivery-birthday',
  deliveryOptout: 'nen-tag-delivery-optout',
  productMince: 'nen-tag-product-mince',
  productRib: 'nen-tag-product-rib',
  productBalance: 'nen-tag-product-balance',
  productTreat: 'nen-tag-product-treat',
  productSet: 'nen-tag-product-set',
  productSingle: 'nen-tag-product-single',
  productTrial: 'nen-tag-product-trial',
  productSubscription: 'nen-tag-product-subscription',
} as const;

type Snapshot = {
  customer_id: string | null;
  orders_json: string;
  subscription_json: string | null;
  purchase_count: number;
  purchase_amount: number;
  member_rank: string;
};

type Pet = {
  animal_type: string;
  birthday: string | null;
  weight_kg: number | null;
  concerns: string;
  image_url: string | null;
};

type Order = {
  date?: string | null;
  paymentMethod?: string | null;
  items?: Array<{ name?: string | null }>;
};

const RANK_TAGS = [NEN_TAG.rankBasic, NEN_TAG.rankSilver, NEN_TAG.rankGold, NEN_TAG.rankPlatinum];
const PURCHASE_STATE_TAGS = [NEN_TAG.purchaseNone, NEN_TAG.purchaseFirst, NEN_TAG.purchaseExperienced, NEN_TAG.purchaseRepeat];
const PURCHASE_RECENCY_TAGS = [NEN_TAG.purchaseRecent30, NEN_TAG.purchaseRecent90, NEN_TAG.purchaseDormant];
const SUBSCRIPTION_STATE_TAGS = [
  NEN_TAG.subscriptionNone, NEN_TAG.subscriptionActive, NEN_TAG.subscriptionPaused,
  NEN_TAG.subscriptionCancelled, NEN_TAG.subscriptionFailed, NEN_TAG.subscriptionNext7d,
];
const PET_STATE_TAGS = [
  NEN_TAG.petUnregistered, NEN_TAG.petRegistered, NEN_TAG.petMultiple, NEN_TAG.petDog,
  NEN_TAG.petCat, NEN_TAG.petDogAndCat, NEN_TAG.petSmallDog, NEN_TAG.petMediumDog,
  NEN_TAG.petLargeDog, NEN_TAG.petYoung, NEN_TAG.petAdult, NEN_TAG.petSenior,
  NEN_TAG.petBirthdayThisMonth, NEN_TAG.petBirthdayNextMonth, NEN_TAG.petPhoto,
  NEN_TAG.concernTear, NEN_TAG.concernCoat, NEN_TAG.concernAllergy, NEN_TAG.concernAppetite,
  NEN_TAG.concernStool, NEN_TAG.concernWeight, NEN_TAG.concernOther,
  NEN_TAG.interestTear, NEN_TAG.interestAllergy, NEN_TAG.interestSkinCoat,
  NEN_TAG.interestWeight, NEN_TAG.interestSenior,
];
const HEALTH_STATE_TAGS = [
  NEN_TAG.healthDiary, NEN_TAG.healthWeightLog, NEN_TAG.healthHeartLog, NEN_TAG.healthBreathLog,
  NEN_TAG.healthAppetiteCheck, NEN_TAG.healthStoolCheck, NEN_TAG.healthWeightCheck,
  NEN_TAG.interestHealth, NEN_TAG.actionDiaryContinued,
];
const PHOTO_STATE_TAGS = [NEN_TAG.actionPhotoPosted, NEN_TAG.actionPhotoReview, NEN_TAG.actionPhotoApproved];
const DELIVERY_ELIGIBILITY_TAGS = [
  NEN_TAG.deliveryOrder, NEN_TAG.deliveryShipped, NEN_TAG.deliveryArrival,
  NEN_TAG.deliveryReview, NEN_TAG.deliveryRecommendation, NEN_TAG.deliveryColumn,
  NEN_TAG.deliveryBirthday,
];
const EC_STATE_TAGS = [
  NEN_TAG.member, NEN_TAG.lineLinked, NEN_TAG.ecLinked, ...RANK_TAGS,
  ...PURCHASE_STATE_TAGS, ...PURCHASE_RECENCY_TAGS,
  NEN_TAG.purchase20k, NEN_TAG.purchase50k, NEN_TAG.purchase100k,
  NEN_TAG.paymentAmazon, NEN_TAG.paymentCard, NEN_TAG.paymentBank,
  ...SUBSCRIPTION_STATE_TAGS,
  NEN_TAG.interestVenison, NEN_TAG.interestPetFood,
  NEN_TAG.productMince, NEN_TAG.productRib, NEN_TAG.productBalance, NEN_TAG.productTreat,
  NEN_TAG.productSet, NEN_TAG.productSingle, NEN_TAG.productTrial, NEN_TAG.productSubscription,
];
const SCHEDULED_REFRESH_BATCH_SIZE = 20;
const ALL_REFRESH_TAGS = [...new Set([
  ...EC_STATE_TAGS,
  ...PET_STATE_TAGS,
  ...HEALTH_STATE_TAGS,
  ...PHOTO_STATE_TAGS,
  ...DELIVERY_ELIGIBILITY_TAGS,
  NEN_TAG.deliveryOptout,
])];

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function daysSince(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.floor((now.getTime() - time) / 86_400_000) : null;
}

function daysUntil(value: unknown, now: Date): number | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(`${value.slice(0, 10)}T00:00:00+09:00`);
  if (!Number.isFinite(time)) return null;
  const todayJst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  todayJst.setHours(0, 0, 0, 0);
  return Math.ceil((time - todayJst.getTime()) / 86_400_000);
}

function productTags(nameValue: unknown): string[] {
  const name = String(nameValue || '').replaceAll(/\s+/g, '');
  const tags = new Set<string>();
  if (/ミンチ/.test(name)) tags.add(NEN_TAG.productMince);
  if (/アバラ骨|あばら骨|肋骨/.test(name)) tags.add(NEN_TAG.productRib);
  if (/毎日の鹿肉バランス|鹿肉バランス/.test(name)) tags.add(NEN_TAG.productBalance);
  if (/おやつ|ジャーキー/.test(name)) tags.add(NEN_TAG.productTreat);
  if (/セット/.test(name)) tags.add(NEN_TAG.productSet);
  if (/お試し|トライアル/.test(name)) tags.add(NEN_TAG.productTrial);
  if (/定期/.test(name)) tags.add(NEN_TAG.productSubscription);
  if (!tags.size || (!/セット|お試し|トライアル|定期/.test(name) && tags.size > 0)) tags.add(NEN_TAG.productSingle);
  return [...tags];
}

export function deriveEcTagIds(snapshot: Snapshot | null, now = new Date()): Set<string> {
  const desired = new Set<string>([NEN_TAG.member, NEN_TAG.lineLinked]);
  if (!snapshot) {
    desired.add(NEN_TAG.rankBasic);
    desired.add(NEN_TAG.purchaseNone);
    desired.add(NEN_TAG.subscriptionNone);
    return desired;
  }
  if (snapshot.customer_id) desired.add(NEN_TAG.ecLinked);

  const amount = Math.max(0, Number(snapshot.purchase_amount || 0));
  const count = Math.max(0, Number(snapshot.purchase_count || 0));
  desired.add(amount >= 100_000 ? NEN_TAG.rankPlatinum : amount >= 50_000 ? NEN_TAG.rankGold : amount >= 20_000 ? NEN_TAG.rankSilver : NEN_TAG.rankBasic);
  if (count === 0) desired.add(NEN_TAG.purchaseNone);
  if (count === 1) desired.add(NEN_TAG.purchaseFirst);
  if (count > 0) desired.add(NEN_TAG.purchaseExperienced);
  if (count >= 2) desired.add(NEN_TAG.purchaseRepeat);
  if (amount >= 20_000) desired.add(NEN_TAG.purchase20k);
  if (amount >= 50_000) desired.add(NEN_TAG.purchase50k);
  if (amount >= 100_000) desired.add(NEN_TAG.purchase100k);

  const orders = parseJson<Order[]>(snapshot.orders_json, []);
  const latestDays = orders
    .map((order) => daysSince(order.date, now))
    .filter((value): value is number => value !== null && value >= 0)
    .sort((left, right) => left - right)[0];
  if (latestDays !== undefined) desired.add(latestDays <= 30 ? NEN_TAG.purchaseRecent30 : latestDays <= 90 ? NEN_TAG.purchaseRecent90 : NEN_TAG.purchaseDormant);
  for (const order of orders) {
    const payment = String(order.paymentMethod || '').toLowerCase();
    if (/amazon/.test(payment)) desired.add(NEN_TAG.paymentAmazon);
    if (/card|credit|クレジット|stripe/.test(payment)) desired.add(NEN_TAG.paymentCard);
    if (/bank|銀行|振込/.test(payment)) desired.add(NEN_TAG.paymentBank);
    for (const item of order.items || []) for (const tag of productTags(item.name)) desired.add(tag);
  }
  if (orders.length) {
    desired.add(NEN_TAG.interestVenison);
    desired.add(NEN_TAG.interestPetFood);
  }

  const subscription = parseJson<{ contracts?: Array<Record<string, unknown>> } | Record<string, unknown> | null>(snapshot.subscription_json, null);
  const contracts = Array.isArray(subscription && 'contracts' in subscription ? subscription.contracts : null)
    ? subscription!.contracts as Array<Record<string, unknown>>
    : subscription ? [subscription as Record<string, unknown>] : [];
  if (!contracts.length) desired.add(NEN_TAG.subscriptionNone);
  for (const contract of contracts) {
    const status = `${String(contract.status || '')} ${String(contract.status_code || '')}`.toLowerCase();
    if (/決済|failed|payment_failed|past_due/.test(status)) desired.add(NEN_TAG.subscriptionFailed);
    else if (/解約|cancel/.test(status)) desired.add(NEN_TAG.subscriptionCancelled);
    else if (/休止|pause|suspend/.test(status)) desired.add(NEN_TAG.subscriptionPaused);
    else if (/契約|active|継続|稼働/.test(status)) desired.add(NEN_TAG.subscriptionActive);
    const upcoming = [contract.next_shipping_date, contract.next_charge_date]
      .map((value) => daysUntil(value, now))
      .some((days) => days !== null && days >= 0 && days <= 7);
    if (upcoming) desired.add(NEN_TAG.subscriptionNext7d);
    for (const item of Array.isArray(contract.items) ? contract.items : []) {
      desired.add(NEN_TAG.productSubscription);
      for (const tag of productTags((item as Record<string, unknown>).name)) desired.add(tag);
    }
  }
  return desired;
}

function ageYears(birthday: string, now: Date): number | null {
  const birth = new Date(`${birthday}T00:00:00+09:00`);
  if (!Number.isFinite(birth.getTime())) return null;
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

export function derivePetTagIds(pets: Pet[], now = new Date()): Set<string> {
  const desired = new Set<string>();
  if (!pets.length) {
    desired.add(NEN_TAG.petUnregistered);
    return desired;
  }
  desired.add(NEN_TAG.petRegistered);
  if (pets.length >= 2) desired.add(NEN_TAG.petMultiple);
  const hasDog = pets.some((pet) => pet.animal_type === 'dog');
  const hasCat = pets.some((pet) => pet.animal_type === 'cat');
  if (hasDog) desired.add(NEN_TAG.petDog);
  if (hasCat) desired.add(NEN_TAG.petCat);
  if (hasDog && hasCat) desired.add(NEN_TAG.petDogAndCat);
  const currentMonth = now.getMonth() + 1;
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
  const concernMap: Record<string, [string, string?]> = {
    tear_stain: [NEN_TAG.concernTear, NEN_TAG.interestTear],
    coat: [NEN_TAG.concernCoat, NEN_TAG.interestSkinCoat],
    allergy: [NEN_TAG.concernAllergy, NEN_TAG.interestAllergy],
    appetite: [NEN_TAG.concernAppetite], stool: [NEN_TAG.concernStool],
    weight: [NEN_TAG.concernWeight, NEN_TAG.interestWeight], other: [NEN_TAG.concernOther],
  };
  for (const pet of pets) {
    if (pet.image_url) desired.add(NEN_TAG.petPhoto);
    if (pet.animal_type === 'dog' && Number.isFinite(pet.weight_kg)) {
      const weight = Number(pet.weight_kg);
      desired.add(weight <= 10 ? NEN_TAG.petSmallDog : weight <= 25 ? NEN_TAG.petMediumDog : NEN_TAG.petLargeDog);
    }
    if (pet.birthday) {
      const age = ageYears(pet.birthday, now);
      if (age !== null) desired.add(age < 1 ? NEN_TAG.petYoung : age >= 7 ? NEN_TAG.petSenior : NEN_TAG.petAdult);
      if (age !== null && age >= 7) desired.add(NEN_TAG.interestSenior);
      const month = Number(pet.birthday.slice(5, 7));
      if (month === currentMonth) desired.add(NEN_TAG.petBirthdayThisMonth);
      if (month === nextMonth) desired.add(NEN_TAG.petBirthdayNextMonth);
    }
    for (const concern of parseJson<string[]>(pet.concerns, [])) {
      for (const tag of concernMap[concern] || []) if (tag) desired.add(tag);
    }
  }
  return desired;
}

async function syncManagedTags(
  db: D1Database,
  friendId: string,
  managed: readonly string[],
  desired: Set<string>,
  prefetchedCurrentIds?: Set<string>,
): Promise<{ added: number; removed: number }> {
  const uniqueManaged = [...new Set(managed)];
  let currentIds = prefetchedCurrentIds;
  if (!currentIds) {
    const placeholders = uniqueManaged.map(() => '?').join(',');
    const current = await db.prepare(
      `SELECT tag_id FROM friend_tags WHERE friend_id = ? AND tag_id IN (${placeholders})`,
    ).bind(friendId, ...uniqueManaged).all<{ tag_id: string }>();
    currentIds = new Set(current.results.map((row) => row.tag_id));
  }
  let added = 0;
  let removed = 0;
  for (const tagId of uniqueManaged) {
    if (desired.has(tagId) && !currentIds.has(tagId)) {
      if ((await attachTagAndFireSideEffects(db, friendId, tagId)).added) added += 1;
    } else if (!desired.has(tagId) && currentIds.has(tagId)) {
      if ((await detachTagAndFireSideEffects(db, friendId, tagId)).removed) removed += 1;
    }
  }
  return { added, removed };
}

export async function syncNenEcTags(db: D1Database, friendId: string, now = new Date()): Promise<{ added: number; removed: number }> {
  const [snapshot, friend] = await Promise.all([
    db.prepare(
      `SELECT customer_id, orders_json, subscription_json, purchase_count, purchase_amount, member_rank
         FROM nen_ec_member_snapshots WHERE friend_id = ?`,
    ).bind(friendId).first<Snapshot>(),
    db.prepare(`SELECT user_id FROM friends WHERE id = ?`).bind(friendId).first<{ user_id: string | null }>(),
  ]);
  const desired = deriveEcTagIds(snapshot, now);
  if (friend?.user_id) desired.add(NEN_TAG.ecLinked);
  return syncManagedTags(db, friendId, EC_STATE_TAGS, desired);
}

export async function syncNenPetTags(db: D1Database, friendId: string, now = new Date()): Promise<{ added: number; removed: number }> {
  const rows = await db.prepare(
    `SELECT animal_type, birthday, weight_kg, concerns, image_url FROM nen_pet_profiles WHERE friend_id = ?`,
  ).bind(friendId).all<Pet>();
  return syncManagedTags(db, friendId, PET_STATE_TAGS, derivePetTagIds(rows.results, now));
}

export async function syncNenHealthTags(db: D1Database, friendId: string, now = new Date()): Promise<{ added: number; removed: number }> {
  const [logs, flags] = await Promise.all([
    db.prepare(
      `SELECT pet_id, logged_on, weight_kg, heart_rate_bpm, respiratory_rate_bpm
         FROM nen_health_logs WHERE friend_id = ? ORDER BY logged_on DESC LIMIT 200`,
    ).bind(friendId).all<{ pet_id: string; logged_on: string; weight_kg: number | null; heart_rate_bpm: number | null; respiratory_rate_bpm: number | null }>(),
    db.prepare(`SELECT flag_type FROM nen_care_flags WHERE friend_id = ? AND status = 'active'`)
      .bind(friendId).all<{ flag_type: string }>(),
  ]);
  const desired = deriveHealthTagIds(logs.results, flags.results, now);
  return syncManagedTags(db, friendId, HEALTH_STATE_TAGS, desired);
}

type HealthLog = {
  pet_id: string;
  logged_on: string;
  weight_kg: number | null;
  heart_rate_bpm: number | null;
  respiratory_rate_bpm: number | null;
};

export function deriveHealthTagIds(
  logs: HealthLog[],
  flags: Array<{ flag_type: string }>,
  now = new Date(),
): Set<string> {
  const desired = new Set<string>();
  if (logs.length) {
    desired.add(NEN_TAG.healthDiary);
    desired.add(NEN_TAG.interestHealth);
  }
  if (logs.some((log) => log.weight_kg !== null)) desired.add(NEN_TAG.healthWeightLog);
  if (logs.some((log) => log.heart_rate_bpm !== null)) desired.add(NEN_TAG.healthHeartLog);
  if (logs.some((log) => log.respiratory_rate_bpm !== null)) desired.add(NEN_TAG.healthBreathLog);
  if (flags.some((flag) => flag.flag_type === 'poor_appetite')) desired.add(NEN_TAG.healthAppetiteCheck);
  if (flags.some((flag) => flag.flag_type === 'abnormal_stool')) desired.add(NEN_TAG.healthStoolCheck);
  const recent30 = logs.filter((log) => (daysSince(log.logged_on, now) ?? 31) <= 30);
  if (recent30.length >= 3) desired.add(NEN_TAG.actionDiaryContinued);
  const byPet = new Map<string, number[]>();
  for (const log of logs) {
    if (log.weight_kg === null) continue;
    const weights = byPet.get(log.pet_id) || [];
    if (weights.length < 2) weights.push(Number(log.weight_kg));
    byPet.set(log.pet_id, weights);
  }
  if ([...byPet.values()].some(([latest, previous]) => previous > 0 && Math.abs(latest - previous) / previous >= 0.1)) {
    desired.add(NEN_TAG.healthWeightCheck);
  }
  return desired;
}

export async function syncNenPhotoTags(db: D1Database, friendId: string): Promise<{ added: number; removed: number }> {
  const counts = await db.prepare(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
            SUM(CASE WHEN status='adopted' THEN 1 ELSE 0 END) adopted
       FROM nen_photo_submissions WHERE friend_id = ?`,
  ).bind(friendId).first<{ total: number; pending: number; adopted: number }>();
  return syncManagedTags(db, friendId, PHOTO_STATE_TAGS, derivePhotoTagIds(counts));
}

function derivePhotoTagIds(
  counts: { total: number; pending: number; adopted: number } | null | undefined,
): Set<string> {
  const desired = new Set<string>();
  if (Number(counts?.total || 0) > 0) desired.add(NEN_TAG.actionPhotoPosted);
  if (Number(counts?.pending || 0) > 0) desired.add(NEN_TAG.actionPhotoReview);
  if (Number(counts?.adopted || 0) > 0) desired.add(NEN_TAG.actionPhotoApproved);
  return desired;
}

async function syncNenDeliveryTags(db: D1Database, friendId: string): Promise<{ added: number; removed: number }> {
  const optedOut = await db.prepare(
    `SELECT 1 found FROM friend_tags WHERE friend_id = ? AND tag_id = ?`,
  ).bind(friendId, NEN_TAG.deliveryOptout).first<{ found: number }>();
  return syncManagedTags(db, friendId, DELIVERY_ELIGIBILITY_TAGS, new Set(optedOut ? [] : DELIVERY_ELIGIBILITY_TAGS));
}

export async function syncAllNenTagsForFriend(db: D1Database, friendId: string, now = new Date()): Promise<{ added: number; removed: number }> {
  const results = [];
  results.push(await syncNenEcTags(db, friendId, now));
  results.push(await syncNenPetTags(db, friendId, now));
  results.push(await syncNenHealthTags(db, friendId, now));
  results.push(await syncNenPhotoTags(db, friendId));
  results.push(await syncNenDeliveryTags(db, friendId));
  return results.reduce((total, result) => ({ added: total.added + result.added, removed: total.removed + result.removed }), { added: 0, removed: 0 });
}

export type NenTagScope = Array<string | null> | { allTenants: true };

type ScheduledRefreshResult = {
  friends: number;
  added: number;
  removed: number;
  hasMore?: boolean;
  cursor?: string | null;
};

type RefreshState = { lastFriendId: string; cycleStartedAt: string };
type RefreshFriend = { id: string; user_id: string | null };
type SnapshotRow = Snapshot & { friend_id: string };
type PetRow = Pet & { friend_id: string };
type HealthLogRow = HealthLog & { friend_id: string };

async function getRefreshState(db: D1Database, now: string): Promise<RefreshState> {
  await db.prepare(
    `INSERT OR IGNORE INTO nen_tag_refresh_state
       (id, last_friend_id, cycle_started_at, updated_at)
     VALUES (1, '', ?, ?)`,
  ).bind(now, now).run();
  const row = await db.prepare(
    `SELECT last_friend_id, cycle_started_at FROM nen_tag_refresh_state WHERE id = 1`,
  ).bind().first<{ last_friend_id: string; cycle_started_at: string }>();
  if (!row) throw new Error('NEN tag refresh state is unavailable');
  return { lastFriendId: row.last_friend_id, cycleStartedAt: row.cycle_started_at };
}

async function saveRefreshState(db: D1Database, state: RefreshState, now: string): Promise<void> {
  await db.prepare(
    `UPDATE nen_tag_refresh_state
        SET last_friend_id = ?, cycle_started_at = ?, updated_at = ?
      WHERE id = 1`,
  ).bind(state.lastFriendId, state.cycleStartedAt, now).run();
}

function rowsByFriend<T extends { friend_id: string }>(rows: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const values = result.get(row.friend_id) ?? [];
    values.push(row);
    result.set(row.friend_id, values);
  }
  return result;
}

async function refreshScheduledNenTags(
  db: D1Database,
  requestedLimit: number,
  now: Date,
): Promise<ScheduledRefreshResult> {
  const nowText = now.toISOString();
  const state = await getRefreshState(db, nowText);
  const batchSize = Math.min(
    SCHEDULED_REFRESH_BATCH_SIZE,
    Math.max(1, Math.min(requestedLimit, 1_000)),
  );
  const page = await db.prepare(
    `SELECT id, user_id FROM friends
      WHERE is_following = 1 AND user_id IS NOT NULL AND user_id <> '' AND id > ?
      ORDER BY id ASC LIMIT ?`,
  ).bind(state.lastFriendId, batchSize + 1).all<RefreshFriend>();
  const hasMore = page.results.length > batchSize;
  const friends = page.results.slice(0, batchSize);

  if (friends.length === 0) {
    await saveRefreshState(db, { lastFriendId: '', cycleStartedAt: nowText }, nowText);
    return { friends: 0, added: 0, removed: 0, hasMore: false, cursor: null };
  }

  const friendIds = friends.map((friend) => friend.id);
  const placeholders = friendIds.map(() => '?').join(',');
  const selectedFriendValues = friendIds.map(() => '(?)').join(',');
  // 1人最大200件を1つのUNIONにまとめる。20人でも健康記録は最大4,000行。
  const healthQuery = `${friendIds.map(() => `
    SELECT friend_id, pet_id, logged_on, weight_kg, heart_rate_bpm, respiratory_rate_bpm
      FROM (
        SELECT friend_id, pet_id, logged_on, weight_kg, heart_rate_bpm, respiratory_rate_bpm
          FROM nen_health_logs WHERE friend_id = ? ORDER BY logged_on DESC LIMIT 200
      )`).join(' UNION ALL ')} ORDER BY friend_id ASC, logged_on DESC`;
  const currentTagQueries = [];
  for (let index = 0; index < ALL_REFRESH_TAGS.length; index += 40) {
    const tagIds = ALL_REFRESH_TAGS.slice(index, index + 40);
    currentTagQueries.push(db.prepare(
      `SELECT friend_id, tag_id FROM friend_tags
        WHERE friend_id IN (${placeholders})
          AND tag_id IN (${tagIds.map(() => '?').join(',')})`,
    ).bind(...friendIds, ...tagIds).all<{ friend_id: string; tag_id: string }>());
  }
  const [snapshots, pets, healthLogs, careFlags, photos, currentTagPages] = await Promise.all([
    db.prepare(
      `SELECT friend_id, customer_id, orders_json, subscription_json,
              purchase_count, purchase_amount, member_rank
         FROM nen_ec_member_snapshots WHERE friend_id IN (${placeholders})`,
    ).bind(...friendIds).all<SnapshotRow>(),
    db.prepare(
      `SELECT friend_id, animal_type, birthday, weight_kg, concerns, image_url
         FROM nen_pet_profiles WHERE friend_id IN (${placeholders})`,
    ).bind(...friendIds).all<PetRow>(),
    db.prepare(healthQuery).bind(...friendIds).all<HealthLogRow>(),
    db.prepare(
      `SELECT friend_id, flag_type FROM nen_care_flags
        WHERE status = 'active' AND friend_id IN (${placeholders})`,
    ).bind(...friendIds).all<{ friend_id: string; flag_type: string }>(),
    db.prepare(
      `WITH selected_friends(friend_id) AS (VALUES ${selectedFriendValues})
       SELECT selected_friends.friend_id,
              EXISTS(
                SELECT 1 FROM nen_photo_submissions
                 WHERE friend_id = selected_friends.friend_id LIMIT 1
              ) total,
              EXISTS(
                SELECT 1 FROM nen_photo_submissions
                 WHERE friend_id = selected_friends.friend_id AND status = 'pending' LIMIT 1
              ) pending,
              EXISTS(
                SELECT 1 FROM nen_photo_submissions
                 WHERE friend_id = selected_friends.friend_id AND status = 'adopted' LIMIT 1
              ) adopted
         FROM selected_friends`,
    ).bind(...friendIds).all<{ friend_id: string; total: number; pending: number; adopted: number }>(),
    Promise.all(currentTagQueries),
  ]);

  const snapshotByFriend = new Map(snapshots.results.map((row) => [row.friend_id, row]));
  const petsByFriend = rowsByFriend(pets.results);
  const healthByFriend = rowsByFriend(healthLogs.results);
  const flagsByFriend = rowsByFriend(careFlags.results);
  const photoByFriend = new Map(photos.results.map((row) => [row.friend_id, row]));
  const tagsByFriend = rowsByFriend(currentTagPages.flatMap((page) => page.results));
  let added = 0;
  let removed = 0;

  for (const friend of friends) {
    const current = new Set((tagsByFriend.get(friend.id) ?? []).map((row) => row.tag_id));
    const ecDesired = deriveEcTagIds(snapshotByFriend.get(friend.id) ?? null, now);
    if (friend.user_id) ecDesired.add(NEN_TAG.ecLinked);
    const desiredGroups: Array<[readonly string[], Set<string>]> = [
      [EC_STATE_TAGS, ecDesired],
      [PET_STATE_TAGS, derivePetTagIds(petsByFriend.get(friend.id) ?? [], now)],
      [HEALTH_STATE_TAGS, deriveHealthTagIds(
        healthByFriend.get(friend.id) ?? [],
        flagsByFriend.get(friend.id) ?? [],
        now,
      )],
      [PHOTO_STATE_TAGS, derivePhotoTagIds(photoByFriend.get(friend.id))],
      [DELIVERY_ELIGIBILITY_TAGS,
        new Set(current.has(NEN_TAG.deliveryOptout) ? [] : DELIVERY_ELIGIBILITY_TAGS)],
    ];
    for (const [managed, desired] of desiredGroups) {
      const changed = await syncManagedTags(db, friend.id, managed, desired, current);
      added += changed.added;
      removed += changed.removed;
    }
  }

  const cursor = hasMore ? friends.at(-1)!.id : null;
  await saveRefreshState(db, hasMore
    ? { ...state, lastFriendId: cursor! }
    : { lastFriendId: '', cycleStartedAt: nowText }, nowText);
  return { friends: friends.length, added, removed, hasMore, cursor };
}

export async function refreshAllNenTags(
  db: D1Database,
  scope: NenTagScope,
  limit = 500,
  now = new Date(),
): Promise<ScheduledRefreshResult> {
  if (!Array.isArray(scope)) return refreshScheduledNenTags(db, limit, now);
  const allowedAccountIds = scope;
  const assignedIds = allowedAccountIds.filter((id): id is string => id !== null);
  const accountWhere = assignedIds.length
    ? `(line_account_id IN (${assignedIds.map(() => '?').join(',')})${allowedAccountIds.includes(null) ? ' OR line_account_id IS NULL' : ''})`
    : allowedAccountIds.includes(null) ? 'line_account_id IS NULL' : '1 = 0';
  const friends = await db.prepare(
    `SELECT id FROM friends
      WHERE is_following = 1 AND user_id IS NOT NULL AND user_id <> ''
        AND ${accountWhere}
      ORDER BY updated_at DESC LIMIT ?`,
  ).bind(...assignedIds, Math.max(1, Math.min(limit, 1000))).all<{ id: string }>();
  let added = 0;
  let removed = 0;
  for (const friend of friends.results) {
    const result = await syncAllNenTagsForFriend(db, friend.id, now);
    added += result.added;
    removed += result.removed;
  }
  return { friends: friends.results.length, added, removed };
}
