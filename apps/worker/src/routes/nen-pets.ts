import { Hono, type Context } from 'hono';
import type { Env } from '../index.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { ACTIVITY_LABELS, DEFAULT_TREAT_LIMIT_PERCENT, getTreatLimitPercent, listFeedingProducts, planForPetRow, pickProduct, stapleProducts, type FeedingProductRow } from '../services/nen-feeding.js';
import { petCallName, petGender } from '../services/nen-pet-name.js';
import {
  APPETITE_LABELS, STOOL_LABELS, lastLoggedLabel, summarizePetHealth, thirtyDaySummary, type HealthLogRow,
} from '../services/nen-health-admin.js';

/**
 * 然-NEN- マイペット（★V6 37-3 `hetvN`）／健康日記（★V6 37-4 `mtoCA`）の管理画面。
 *
 * ペットの正本は LINE 側（nen_pet_profiles）。お客様がマイページで登録・更新し、ここでは一覧と気づきを出す。
 * 「今日の目安」は `services/nen-feeding.ts`（NRC／FEDIAF）で表示のたびに計算する。
 * 主食のカロリー表は `/api/nen/feeding-products`（routes/nen-ranks.ts）。
 */
const nenPets = new Hono<Env>();

const PAGE_SIZE = 20;
const STALE_WEIGHT_DAYS = 90;
const MAX_PETS = 3000;

type PetRow = {
  id: string; friend_id: string; customer_id: string | null; name: string; animal_type: string; gender: string; breed: string | null;
  birthday: string | null; weight_kg: number | null; neutered: number | null; activity_level: string | null; feeding_product_id: string | null;
  image_url: string | null; created_at: string; updated_at: string;
  owner_name: string | null; owner_picture_url: string | null; ec_customer_id: string | null;
};

function accountIdFrom(c: Context<Env>): string {
  return (c.req.query('accountId') ?? '').trim();
}

async function requireAccount(c: Context<Env>, accountId: string): Promise<Response | null> {
  if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  return null;
}

async function loadPets(db: D1Database, accountId: string): Promise<PetRow[]> {
  const rows = await db.prepare(
    `SELECT p.id, p.friend_id, p.customer_id, p.name, p.animal_type, p.gender, p.breed, p.birthday, p.weight_kg,
            p.neutered, p.activity_level, p.feeding_product_id, p.image_url, p.created_at, p.updated_at,
            f.display_name AS owner_name, f.picture_url AS owner_picture_url, s.customer_id AS ec_customer_id
       FROM nen_pet_profiles p
       JOIN friends f ON f.id = p.friend_id
       LEFT JOIN nen_ec_member_snapshots s ON s.friend_id = f.id
      WHERE f.line_account_id = ?
      ORDER BY p.updated_at DESC
      LIMIT ?`,
  ).bind(accountId, MAX_PETS).all<PetRow>();
  return rows.results ?? [];
}

function ageLabel(birthday: string | null, today: Date): string {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return '—';
  const born = new Date(`${birthday}T00:00:00Z`);
  let months = (today.getUTCFullYear() - born.getUTCFullYear()) * 12 + (today.getUTCMonth() - born.getUTCMonth());
  if (today.getUTCDate() < born.getUTCDate()) months -= 1;
  if (months < 0) return '—';
  if (months < 12) return `${months}か月`;
  return `${Math.floor(months / 12)}歳${months % 12}か月`;
}

function daysBetween(iso: string, today: Date): number | null {
  const t = Date.parse(iso.replace(' ', 'T'));
  if (!Number.isFinite(t)) return null;
  return Math.floor((today.getTime() - t) / 86_400_000);
}

function petView(row: PetRow, products: FeedingProductRow[], today: Date, treatLimitPercent = DEFAULT_TREAT_LIMIT_PERCENT) {
  const plan = planForPetRow({
    id: row.id, animal_type: row.animal_type, weight_kg: row.weight_kg, birthday: row.birthday,
    neutered: row.neutered, activity_level: row.activity_level, feeding_product_id: row.feeding_product_id,
  }, products, today, treatLimitPercent);
  const product = pickProduct(products, row.feeding_product_id);
  const weightAgeDays = daysBetween(row.updated_at, today);
  return {
    id: row.id,
    name: row.name,
    callName: petCallName(row.name, row.gender),
    gender: petGender(row.gender),
    animalType: row.animal_type === 'cat' ? 'cat' : 'dog',
    breed: row.breed ?? '',
    birthday: row.birthday,
    ageLabel: ageLabel(row.birthday, today),
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    neutered: row.neutered === 1 ? 'yes' : row.neutered === 0 ? 'no' : 'unknown',
    activityLevel: (row.activity_level === 'low' || row.activity_level === 'high' ? row.activity_level : 'normal') as 'low' | 'normal' | 'high',
    activityLabel: ACTIVITY_LABELS[row.activity_level === 'low' || row.activity_level === 'high' ? row.activity_level : 'normal'],
    productName: product?.name ?? null,
    feeding: plan ? { dailyKcal: plan.dailyKcal, dailyGrams: plan.dailyGrams, factorLabel: plan.factorLabel, stageLabel: plan.stageLabel, venisonGrams: plan.venison.grams, venisonKcal: plan.venison.kcal, treatName: plan.venison.product?.name ?? null } : null,
    imageUrl: row.image_url,
    updatedAt: row.updated_at,
    weightStale: weightAgeDays != null && weightAgeDays >= STALE_WEIGHT_DAYS,
    owner: { friendId: row.friend_id, name: row.owner_name ?? '', pictureUrl: row.owner_picture_url, customerId: row.ec_customer_id ?? row.customer_id ?? null },
  };
}

/** 1 ページ 20 件。CSV 書き出しは `pageSize=all`（上限 MAX_PETS）でまとめて取る。 */
function paginate<T>(items: T[], pageParam: string | undefined, sizeParam?: string) {
  const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1);
  const pageSize = sizeParam === 'all' ? MAX_PETS : Math.min(MAX_PETS, Math.max(1, Number.parseInt(sizeParam ?? '', 10) || PAGE_SIZE));
  const start = (page - 1) * pageSize;
  return { page, pageSize, total: items.length, items: items.slice(start, start + pageSize) };
}

function matchesQuery(row: PetRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [row.name, row.breed ?? '', row.owner_name ?? '', row.ec_customer_id ?? '', row.customer_id ?? '']
    .some((value) => value.toLowerCase().includes(needle));
}

// ---------------------------------------------------------------- マイペット（37-3）

nenPets.get('/api/nen/pets', async (c) => {
  const accountId = accountIdFrom(c);
  const denied = await requireAccount(c, accountId);
  if (denied) return denied;
  const today = new Date();
  const [pets, products, treatLimitPercent] = await Promise.all([loadPets(c.env.DB, accountId), listFeedingProducts(c.env.DB, accountId), getTreatLimitPercent(c.env.DB, accountId)]);
  const views = pets.map((row) => petView(row, products, today, treatLimitPercent));

  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const kpis = {
    total: views.length,
    dogs: views.filter((p) => p.animalType === 'dog').length,
    cats: views.filter((p) => p.animalType === 'cat').length,
    newThisMonth: pets.filter((p) => p.created_at.slice(0, 10) >= monthStart).length,
    computable: views.filter((p) => p.feeding?.dailyGrams != null).length,
    staleWeight: views.filter((p) => p.weightStale).length,
  };

  const q = (c.req.query('q') ?? '').trim();
  const species = c.req.query('species') ?? '';
  const product = c.req.query('product') ?? '';
  const weight = c.req.query('weight') ?? '';
  const sort = c.req.query('sort') ?? 'updated_desc';
  let filtered = views.filter((p, index) => matchesQuery(pets[index], q)
    && (species === 'dog' || species === 'cat' ? p.animalType === species : true)
    && (product === 'none' ? p.productName == null : product ? pets[index].feeding_product_id === product : true)
    && (weight === 'stale' ? p.weightStale : weight === 'fresh' ? !p.weightStale : true));
  if (sort === 'name') filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  else if (sort === 'weight_desc') filtered = [...filtered].sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0));
  else if (sort === 'age_desc') filtered = [...filtered].sort((a, b) => (a.birthday ?? '9999').localeCompare(b.birthday ?? '9999'));

  return c.json({ success: true, data: { ...paginate(filtered, c.req.query('page'), c.req.query('pageSize')), kpis, products: stapleProducts(products).map((p) => ({ id: p.id, name: p.name })), treatLimitPercent } });
});

// ---------------------------------------------------------------- 健康日記（37-4）

type HealthRow = HealthLogRow & { pet_id: string };

async function loadRecentLogs(db: D1Database, accountId: string, sinceDays: number): Promise<HealthRow[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.prepare(
    `SELECT h.pet_id, h.logged_on, h.weight_kg, h.stool_status, h.appetite, h.skin_status, h.tear_stain_status,
            h.heart_rate_bpm, h.respiratory_rate_bpm, h.note
       FROM nen_health_logs h JOIN friends f ON f.id = h.friend_id
      WHERE f.line_account_id = ? AND h.logged_on >= ?
      ORDER BY h.logged_on ASC`,
  ).bind(accountId, since).all<HealthRow>();
  return rows.results ?? [];
}

nenPets.get('/api/nen/health', async (c) => {
  const accountId = accountIdFrom(c);
  const denied = await requireAccount(c, accountId);
  if (denied) return denied;
  const today = new Date();
  const [pets, logs, lastByPet] = await Promise.all([
    loadPets(c.env.DB, accountId),
    loadRecentLogs(c.env.DB, accountId, 70),
    c.env.DB.prepare(
      `SELECT h.pet_id, MAX(h.logged_on) AS last_logged_on, COUNT(*) AS total
         FROM nen_health_logs h JOIN friends f ON f.id = h.friend_id
        WHERE f.line_account_id = ? GROUP BY h.pet_id`,
    ).bind(accountId).all<{ pet_id: string; last_logged_on: string; total: number }>(),
  ]);
  const totals = new Map((lastByPet.results ?? []).map((row) => [row.pet_id, row]));
  const byPet = new Map<string, HealthRow[]>();
  for (const log of logs) { const list = byPet.get(log.pet_id) ?? []; list.push(log); byPet.set(log.pet_id, list); }

  const weekAgo = new Date(today.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const rows = pets.filter((pet) => totals.has(pet.id)).map((pet) => {
    const summary = summarizePetHealth(byPet.get(pet.id) ?? [], today);
    const meta = totals.get(pet.id)!;
    // 直近 70 日に記録が無い場合でも「最終記録」は全期間から出す。
    if (!summary.lastLoggedOn && meta.last_logged_on) {
      summary.lastLoggedOn = meta.last_logged_on;
      summary.daysSinceLast = Math.floor((today.getTime() - Date.parse(`${meta.last_logged_on}T00:00:00Z`)) / 86_400_000);
      if (summary.daysSinceLast >= 30 && !summary.changes.some((ch) => ch.key === 'silent')) summary.changes.push({ key: 'silent', label: '30日以上 記録なし', tone: 'faint' });
    }
    return {
      pet: { id: pet.id, name: pet.name, callName: petCallName(pet.name, pet.gender), animalType: pet.animal_type === 'cat' ? 'cat' : 'dog', breed: pet.breed ?? '', ageLabel: ageLabel(pet.birthday, today), imageUrl: pet.image_url },
      owner: { friendId: pet.friend_id, name: pet.owner_name ?? '', customerId: pet.ec_customer_id ?? pet.customer_id ?? null },
      lastLoggedOn: summary.lastLoggedOn,
      lastLoggedLabel: lastLoggedLabel(summary),
      daysSinceLast: summary.daysSinceLast,
      count30d: summary.count30d,
      totalRecords: Number(meta.total),
      weightSeries: summary.weightSeries,
      latestWeightKg: summary.latestWeightKg,
      weightChangePercent: summary.weightChangePercent,
      latestStool: summary.latestStool ? STOOL_LABELS[summary.latestStool] ?? summary.latestStool : null,
      latestAppetite: summary.latestAppetite ? APPETITE_LABELS[summary.latestAppetite] ?? summary.latestAppetite : null,
      changes: summary.changes,
      concerning: summary.changes.some((ch) => ch.tone === 'warn'),
    };
  });

  const kpis = {
    recordsThisWeek: logs.filter((log) => log.logged_on >= weekAgo).length,
    petsWithRecords: rows.length,
    petsTotal: pets.length,
    concerning: rows.filter((row) => row.concerning).length,
    silent30: rows.filter((row) => row.changes.some((ch) => ch.key === 'silent')).length,
  };

  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const change = c.req.query('change') ?? '';
  const last = c.req.query('last') ?? '';
  const sort = c.req.query('sort') ?? 'concern';
  let filtered = rows.filter((row) => (!q || row.pet.name.toLowerCase().includes(q) || row.owner.name.toLowerCase().includes(q))
    && (change === 'concern' ? row.concerning : change === 'silent' ? row.changes.some((ch) => ch.key === 'silent') : change === 'none' ? row.changes.length === 0 : true)
    && (last === '7' ? (row.daysSinceLast ?? 999) <= 7 : last === '30' ? (row.daysSinceLast ?? 999) <= 30 : last === 'over30' ? (row.daysSinceLast ?? 999) > 30 : true));
  if (sort === 'concern') filtered = [...filtered].sort((a, b) => Number(b.concerning) - Number(a.concerning) || (a.daysSinceLast ?? 999) - (b.daysSinceLast ?? 999));
  else if (sort === 'recent') filtered = [...filtered].sort((a, b) => (a.daysSinceLast ?? 999) - (b.daysSinceLast ?? 999));
  else if (sort === 'records_desc') filtered = [...filtered].sort((a, b) => b.count30d - a.count30d);

  return c.json({ success: true, data: { ...paginate(filtered, c.req.query('page'), c.req.query('pageSize')), kpis } });
});

nenPets.get('/api/nen/health/:petId/summary', async (c) => {
  const accountId = accountIdFrom(c);
  const denied = await requireAccount(c, accountId);
  if (denied) return denied;
  const petId = c.req.param('petId');
  const pet = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.gender, p.animal_type, p.breed, p.birthday, p.weight_kg, p.friend_id, f.display_name AS owner_name
       FROM nen_pet_profiles p JOIN friends f ON f.id = p.friend_id
      WHERE p.id = ? AND f.line_account_id = ?`,
  ).bind(petId, accountId).first<{ id: string; name: string; gender: string | null; animal_type: string; breed: string | null; birthday: string | null; weight_kg: number | null; friend_id: string; owner_name: string | null }>();
  if (!pet) return c.json({ success: false, error: 'Pet not found' }, 404);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const logs = await c.env.DB.prepare(
    `SELECT pet_id, logged_on, weight_kg, stool_status, appetite, skin_status, tear_stain_status, heart_rate_bpm, respiratory_rate_bpm, note
       FROM nen_health_logs WHERE pet_id = ? AND logged_on >= ? ORDER BY logged_on DESC`,
  ).bind(petId, since).all<HealthRow>();
  const today = new Date();
  return c.json({ success: true, data: {
    pet: { id: pet.id, name: pet.name, callName: petCallName(pet.name, pet.gender), animalType: pet.animal_type === 'cat' ? 'cat' : 'dog', breed: pet.breed ?? '', ageLabel: ageLabel(pet.birthday, today), weightKg: pet.weight_kg },
    owner: { friendId: pet.friend_id, name: pet.owner_name ?? '' },
    generatedAt: today.toISOString(),
    summary: thirtyDaySummary(logs.results ?? [], today),
    labels: { stool: STOOL_LABELS, appetite: APPETITE_LABELS },
  } });
});

export { nenPets };
