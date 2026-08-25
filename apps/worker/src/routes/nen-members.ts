import { Hono, type Context } from 'hono';
import type { Message } from '@line-crm/line-sdk';
import { getFriendByLineUserIdForAccount, jstNow, resolveLineCredential } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { verifyCallerLineIdentity } from '../services/liff-auth.js';
import { pushViaHarnessProxy } from '../services/line-proxy-send.js';
import { dispatchLineProxyLocally } from '../services/local-line-proxy.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { installNenRichMenu } from '../services/nen-rich-menu.js';
import { attachTagAndFireSideEffects } from '../services/friend-tag-attach.js';
import {
  refreshAllNenTags,
  syncNenHealthTags,
  syncNenPetTags,
  syncNenPhotoTags,
} from '../services/nen-tag-sync.js';

const nenMembers = new Hono<Env>();
const CONCERNS = new Set(['tear_stain', 'coat', 'allergy', 'appetite', 'stool', 'weight', 'other']);
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PHOTO_ADOPTION_POINTS = 5;

const CONSULTATION_TAG_RULES = [
  { key: '食事', pattern: /ご飯|ごはん|フード|食欲|食いつき|食べ|偏食|おやつ|栄養|サプリ|水分|飲み水/ },
  { key: '排泄', pattern: /便|うんち|ウンチ|下痢|軟便|便秘|血便|おしっこ|オシッコ|尿|トイレ|排泄/ },
  { key: '皮膚・被毛', pattern: /皮膚|毛並み|被毛|脱毛|毛玉|ブラッシング|シャンプー|かゆ|痒|アレルギー|舐め続け/ },
  { key: '目・涙', pattern: /目|涙|目やに|まつげ|充血/ },
  { key: '耳', pattern: /耳|イヤー/ },
  { key: '口・歯', pattern: /口臭|口内|歯|デンタル|歯周|ひげ|ヒゲ/ },
  { key: '呼吸', pattern: /咳|呼吸|息|しゃっくり|くしゃみ|いびき|ゼーゼー/ },
  { key: '行動・しつけ', pattern: /しつけ|噛|吠|鳴|威嚇|遊|留守番|ストレス|散歩|興奮|嫉妬|多頭|怖が|震え/ },
  { key: '生活環境', pattern: /ケージ|クレート|サークル|旅行|電車|タクシー|ホテル|寝床|ベッド|室内/ },
  { key: '予防・通院', pattern: /ワクチン|感染症|薬|病院|疾患|発情|ヒート|手術/ },
  { key: '消化器', pattern: /嘔吐|吐く|吐いた|胃|腸|膵|腹痛|お腹/ },
  { key: '泌尿器', pattern: /腎|膀胱|尿|結石|頻尿/ },
  { key: '運動器', pattern: /関節|歩き|歩行|足|脚|骨|びっこ|立てない/ },
  { key: '神経', pattern: /けいれん|痙攣|発作|神経|麻痺|ふらつき/ },
  { key: '心臓', pattern: /心臓|心拍|脈|循環/ },
  { key: '腫瘍', pattern: /腫瘍|がん|癌|しこり/ },
  { key: '中毒', pattern: /中毒|毒|誤食|誤飲|チョコ|玉ねぎ|ネギ|キシリトール/ },
  { key: '高齢', pattern: /高齢|シニア|老犬|老猫|認知/ },
] as const;
const URGENT_PATTERN = /呼吸.{0,4}(苦し|でき)|意識|けいれん|痙攣|大量.{0,3}(出血|吐血)|誤飲|毒|ぐったり.{0,8}(反応|動か)|何度も.{0,3}(吐|嘔吐)|血便|尿が出ない/;
const CAUTION_PATTERN = /食べない|下痢|嘔吐|咳|発熱|元気がない|痛が|出血|腫れ|急に|続いて|繰り返/;

type FriendRow = {
  id: string; line_user_id: string; display_name: string | null; user_id: string | null;
  line_account_id: string | null; channel_access_token: string | null;
  channel_access_token_encrypted: string | null;
};

async function currentFriend(c: Context<Env>): Promise<FriendRow | null> {
  const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
  if (!identity) return null;
  const friend = await getFriendByLineUserIdForAccount(
    c.env.DB,
    identity.lineUserId,
    identity.lineAccountId,
  );
  if (!friend?.is_following) return null;
  return c.env.DB.prepare(
    `SELECT f.id, f.line_user_id, f.display_name, f.user_id, f.line_account_id,
            a.channel_access_token, a.channel_access_token_encrypted
       FROM friends f LEFT JOIN line_accounts a ON a.id = f.line_account_id
      WHERE f.id = ? AND f.is_following = 1 LIMIT 1`,
  ).bind(friend.id).first<FriendRow>();
}

function dateOnly(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ? value : null;
}

function feedingGuide(animalType: string, weightKg: number) {
  // NENの初期目安。主食商品の熱量・年齢・活動量・体調で調整する前提で、
  // LIFF画面にも必ず「医療判断ではない目安」と表示する。
  const minPerKg = animalType === 'cat' ? 25 : 20;
  const maxPerKg = animalType === 'cat' ? 35 : 30;
  const min = Math.max(1, Math.round(weightKg * minPerKg));
  const max = Math.max(min, Math.round(weightKg * maxPerKg));
  const daily = Math.round((min + max) / 2);
  return {
    daily, min, max,
    venison: Math.max(1, Math.round(daily * 0.1)),
    cycleDays: Math.max(1, Math.round(1000 / daily)),
  };
}

function petCard(pet: Record<string, unknown>): Message {
  const guide = `${pet.recommended_daily_min_grams}〜${pet.recommended_daily_max_grams}g/日`;
  return {
    type: 'flex', altText: `${pet.name}ちゃんのマイペット登録が完了しました`,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
        { type: 'text', text: 'MY PET CARD', size: 'xs', weight: 'bold', color: '#16815B' },
        { type: 'text', text: `${pet.name}ちゃん`, size: 'xl', weight: 'bold', color: '#123F2B' },
        { type: 'text', text: `${pet.animal_type === 'cat' ? '猫' : '犬'}・${pet.breed || '品種未登録'}・${pet.weight_kg}kg`, size: 'sm', color: '#64748B', wrap: true },
        { type: 'separator' },
        { type: 'text', text: `1日のフード目安：${guide}`, size: 'sm', color: '#334155', wrap: true },
        { type: 'text', text: `鹿肉をトッピングする場合の目安：${pet.venison_daily_grams}g/日まで`, size: 'sm', color: '#334155', wrap: true },
        { type: 'text', text: `1kgのフード：約${pet.food_cycle_days}日分`, size: 'sm', color: '#334155', wrap: true },
        { type: 'text', text: '※年齢・活動量・体調・商品の熱量で変わる一般的な目安です。心配な症状は獣医師へご相談ください。', size: 'xs', color: '#94A3B8', wrap: true },
      ] },
    },
  } as Message;
}

async function pushPetCard(c: Context<Env>, friend: FriendRow, pet: Record<string, unknown>) {
  if (!friend.channel_access_token) return;
  const accessToken = await resolveLineCredential(
    friend.channel_access_token_encrypted,
    friend.channel_access_token,
    {
      lineAccountId: friend.line_account_id ?? 'unassigned',
      field: 'channel_access_token',
    },
  );
  await pushViaHarnessProxy(
    c.env.WORKER_PUBLIC_URL || new URL(c.req.url).origin,
    accessToken,
    friend.line_user_id,
    [petCard(pet)],
    crypto.randomUUID(),
    (request) => dispatchLineProxyLocally(request, c.env, c.executionCtx),
  );
}

function mapPet(row: Record<string, unknown>) {
  return {
    id: row.id, customerId: row.customer_id, name: row.name, animalType: row.animal_type,
    gender: row.gender, breed: row.breed, birthday: row.birthday, weightKg: row.weight_kg,
    concerns: JSON.parse(String(row.concerns || '[]')),
    recommendedDailyGrams: row.recommended_daily_grams,
    recommendedDailyMinGrams: row.recommended_daily_min_grams,
    recommendedDailyMaxGrams: row.recommended_daily_max_grams,
    venisonDailyGrams: row.venison_daily_grams, foodCycleDays: row.food_cycle_days,
    imageUrl: row.image_url || null,
  };
}

function decodeJpegData(data: unknown): Uint8Array | null {
  if (typeof data !== 'string' || !data.startsWith('data:image/jpeg;base64,')) return null;
  const raw = data.slice('data:image/jpeg;base64,'.length);
  if (!raw || raw.length > 2_100_000) return null;
  try {
    const bytes = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0));
    return bytes.byteLength <= 1_500_000 ? bytes : null;
  } catch {
    return null;
  }
}

nenMembers.get('/api/liff/nen/member', async (c) => {
  const friend = await currentFriend(c);
  if (!friend) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const [pets, snapshot, photos, photoStats, consultations] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM nen_pet_profiles WHERE friend_id = ? ORDER BY created_at`).bind(friend.id).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT * FROM nen_ec_member_snapshots WHERE friend_id = ?`).bind(friend.id).first<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT ps.id, ps.pet_id, ps.image_url, ps.caption, ps.status, ps.awarded_points, ps.created_at, p.name pet_name
      FROM nen_photo_submissions ps JOIN nen_pet_profiles p ON p.id = ps.pet_id
      WHERE ps.status = 'adopted' ORDER BY ps.reviewed_at DESC, ps.created_at DESC LIMIT 30`).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT COUNT(*) submitted_count,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending_count,
      SUM(CASE WHEN status='adopted' THEN 1 ELSE 0 END) adopted_count,
      SUM(CASE WHEN status='adopted' THEN awarded_points ELSE 0 END) earned_points
      FROM nen_photo_submissions WHERE friend_id = ?`).bind(friend.id).first<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT id, pet_id, topic, result_text, tag_name, created_at FROM nen_consultation_logs_v2 WHERE friend_id = ? ORDER BY created_at DESC LIMIT 20`).bind(friend.id).all<Record<string, unknown>>(),
  ]);
  return c.json({ success: true, data: {
    owner: { displayName: friend.display_name, customerId: snapshot?.customer_id || null },
    pets: pets.results.map(mapPet),
    commerce: snapshot ? {
      orders: JSON.parse(String(snapshot.orders_json || '[]')),
      subscription: snapshot.subscription_json ? JSON.parse(String(snapshot.subscription_json)) : null,
      purchaseCount: snapshot.purchase_count, purchaseAmount: snapshot.purchase_amount,
      points: snapshot.point_balance, rank: snapshot.member_rank, syncedAt: snapshot.synced_at,
    } : { orders: [], subscription: null, purchaseCount: 0, purchaseAmount: 0, points: 0, rank: 'レギュラー', syncedAt: null },
    photos: photos.results.map((r) => ({ id: r.id, petId: r.pet_id, petName: r.pet_name, imageUrl: r.image_url, caption: r.caption, status: r.status, awardedPoints: r.awarded_points, createdAt: r.created_at })),
    photoStats: {
      submittedCount: Number(photoStats?.submitted_count || 0),
      pendingCount: Number(photoStats?.pending_count || 0),
      adoptedCount: Number(photoStats?.adopted_count || 0),
      earnedPoints: Number(photoStats?.earned_points || 0),
    },
    consultations: consultations.results,
  } });
});

nenMembers.get('/api/public/nen/adopted-photos', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT ps.id, ps.image_url, ps.caption, ps.reviewed_at, p.name pet_name
    FROM nen_photo_submissions ps JOIN nen_pet_profiles p ON p.id = ps.pet_id
    WHERE ps.status = 'adopted' ORDER BY ps.reviewed_at DESC, ps.created_at DESC LIMIT 24`).all<Record<string, unknown>>();
  const origin = c.req.header('Origin') || '';
  const allowed = new Set(['https://stg.nen-petfood.com', 'https://nen-petfood.com', 'https://www.nen-petfood.com']);
  if (allowed.has(origin)) c.header('Access-Control-Allow-Origin', origin);
  c.header('Cache-Control', 'public, max-age=60, s-maxage=300');
  return c.json({ success: true, data: rows.results.map((row) => ({
    id: row.id, imageUrl: row.image_url, caption: row.caption, petName: row.pet_name,
  })) });
});

nenMembers.get('/api/public/nen/gallery-preview', async (c) => {
  const baseUrl = c.env.NEN_EC_BASE_URL || 'https://stg.nen-petfood.com';
  try {
    const response = await fetch(new URL('/', baseUrl), {
      headers: { 'User-Agent': 'NEN-Line-Gallery-Sync/1.0' },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!response.ok) throw new Error(`EC gallery returned ${response.status}`);
    const html = await response.text();
    const images: Array<{ imageUrl: string; alt: string }> = [];
    const seen = new Set<string>();
    const pattern = /<img\b[^>]*?src=["']([^"']*\/html\/user_data\/assets\/img\/customer-stories\/[^"']+)["'][^>]*?(?:alt=["']([^"']*)["'])?[^>]*>/giu;
    for (const match of html.matchAll(pattern)) {
      const imageUrl = new URL(match[1], baseUrl).toString();
      if (seen.has(imageUrl)) continue;
      seen.add(imageUrl);
      images.push({ imageUrl, alt: match[2] || 'お客様と然' });
      if (images.length >= 12) break;
    }
    c.header('Cache-Control', 'public, max-age=300, s-maxage=600');
    return c.json({ success: true, data: images });
  } catch (error) {
    console.error('NEN gallery preview sync failed', error);
    c.header('Cache-Control', 'public, max-age=30');
    return c.json({ success: true, data: [] });
  }
});

nenMembers.post('/api/liff/nen/pets', async (c) => {
  const friend = await currentFriend(c);
  if (!friend) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const animalType = body?.animalType === 'cat' ? 'cat' : body?.animalType === 'dog' ? 'dog' : '';
  const breed = typeof body?.breed === 'string' ? body.breed.trim().slice(0, 80) : '';
  const weightKg = Number(body?.weightKg);
  const birthday = dateOnly(body?.birthday);
  const concerns = Array.isArray(body?.concerns) ? body.concerns.filter((v): v is string => typeof v === 'string' && CONCERNS.has(v)).slice(0, 10) : [];
  if (!name || name.length > 80 || !animalType || !breed || !birthday || !Number.isFinite(weightKg) || weightKg < 0.2 || weightKg > 150) {
    return c.json({ success: false, error: '入力内容を確認してください' }, 400);
  }
  const guide = feedingGuide(animalType, weightKg);
  const id = crypto.randomUUID();
  const now = jstNow();
  const photoBytes = body?.photoData ? decodeJpegData(body.photoData) : null;
  if (body?.photoData && !photoBytes) return c.json({ success: false, error: 'ペット写真を確認してください' }, 400);
  const photoKey = photoBytes ? `nen-pet-profiles/${friend.id}/${id}.jpg` : null;
  const imageUrl = photoKey ? `${c.env.WORKER_PUBLIC_URL || new URL(c.req.url).origin}/images/${photoKey}` : null;
  if (photoBytes && photoKey) await c.env.IMAGES.put(photoKey, photoBytes, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { friendId: friend.id, petId: id } });
  await c.env.DB.prepare(
    `INSERT INTO nen_pet_profiles
      (id, friend_id, customer_id, name, animal_type, gender, birthday, breed, weight_kg, concerns,
       recommended_daily_grams, recommended_daily_min_grams, recommended_daily_max_grams,
       venison_daily_grams, food_cycle_days, image_r2_key, image_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, friend.id, friend.user_id, name, animalType,
    ['male', 'female'].includes(String(body?.gender)) ? String(body?.gender) : 'unknown',
    birthday, breed, weightKg, JSON.stringify(concerns), guide.daily, guide.min, guide.max,
    guide.venison, guide.cycleDays, photoKey, imageUrl, now, now,
  ).run();
  await syncNenPetTags(c.env.DB, friend.id);
  const saved = await c.env.DB.prepare(`SELECT * FROM nen_pet_profiles WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (saved) c.executionCtx.waitUntil(pushPetCard(c, friend, saved).catch((err: unknown) => console.error('pet card push failed', err)));
  return c.json({ success: true, data: mapPet(saved || { id }) }, 201);
});

nenMembers.post('/api/liff/nen/pets/:id/photo', async (c) => {
  const friend = await currentFriend(c);
  if (!friend) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const pet = await c.env.DB.prepare(`SELECT id, image_r2_key FROM nen_pet_profiles WHERE id=? AND friend_id=?`)
    .bind(c.req.param('id'), friend.id).first<{ id: string; image_r2_key: string | null }>();
  if (!pet) return c.json({ success: false, error: 'Pet not found' }, 404);
  const body = await c.req.json<{ data?: string }>().catch(() => null);
  const bytes = decodeJpegData(body?.data);
  if (!bytes) return c.json({ success: false, error: 'ペット写真を確認してください' }, 400);
  const key = `nen-pet-profiles/${friend.id}/${pet.id}-${crypto.randomUUID()}.jpg`;
  await c.env.IMAGES.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { friendId: friend.id, petId: pet.id } });
  const imageUrl = `${c.env.WORKER_PUBLIC_URL || new URL(c.req.url).origin}/images/${key}`;
  await c.env.DB.prepare(`UPDATE nen_pet_profiles SET image_r2_key=?, image_url=?, updated_at=? WHERE id=? AND friend_id=?`)
    .bind(key, imageUrl, jstNow(), pet.id, friend.id).run();
  await syncNenPetTags(c.env.DB, friend.id);
  if (pet.image_r2_key) c.executionCtx.waitUntil(c.env.IMAGES.delete(pet.image_r2_key).catch(() => undefined));
  return c.json({ success: true, data: { imageUrl } });
});

nenMembers.post('/api/liff/nen/health-logs', async (c) => {
  const friend = await currentFriend(c);
  if (!friend) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const pet = await c.env.DB.prepare(`SELECT id FROM nen_pet_profiles WHERE id = ? AND friend_id = ?`).bind(String(body?.petId || ''), friend.id).first();
  const loggedOn = dateOnly(body?.loggedOn) || new Date().toISOString().slice(0, 10);
  const stool = ['normal', 'soft', 'hard', 'diarrhea', 'bloody', 'other'].includes(String(body?.stoolStatus)) ? String(body?.stoolStatus) : '';
  const appetite = ['good', 'normal', 'poor'].includes(String(body?.appetite)) ? String(body?.appetite) : '';
  const skin = ['normal', 'itchy', 'red', 'other'].includes(String(body?.skinStatus)) ? String(body?.skinStatus) : 'normal';
  const tear = ['normal', 'mild', 'concern'].includes(String(body?.tearStainStatus)) ? String(body?.tearStainStatus) : 'normal';
  const weightKg = body?.weightKg == null || body.weightKg === '' ? null : Number(body.weightKg);
  const heartRateBpm = body?.heartRateBpm == null || body.heartRateBpm === '' ? null : Number(body.heartRateBpm);
  const respiratoryRateBpm = body?.respiratoryRateBpm == null || body.respiratoryRateBpm === '' ? null : Number(body.respiratoryRateBpm);
  const invalidVitals = (weightKg != null && (!Number.isFinite(weightKg) || weightKg < 0.2 || weightKg > 150))
    || (heartRateBpm != null && (!Number.isInteger(heartRateBpm) || heartRateBpm < 20 || heartRateBpm > 300))
    || (respiratoryRateBpm != null && (!Number.isInteger(respiratoryRateBpm) || respiratoryRateBpm < 5 || respiratoryRateBpm > 150));
  if (!pet || !stool || !appetite || invalidVitals) return c.json({ success: false, error: '入力内容を確認してください' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO nen_health_logs (id, pet_id, friend_id, logged_on, weight_kg, heart_rate_bpm, respiratory_rate_bpm, stool_status, appetite, skin_status, tear_stain_status, note, care_flag, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(pet_id, logged_on) DO UPDATE SET weight_kg=COALESCE(excluded.weight_kg, weight_kg),
       heart_rate_bpm=COALESCE(excluded.heart_rate_bpm, heart_rate_bpm),
       respiratory_rate_bpm=COALESCE(excluded.respiratory_rate_bpm, respiratory_rate_bpm), stool_status=excluded.stool_status,
       appetite=excluded.appetite, skin_status=excluded.skin_status, tear_stain_status=excluded.tear_stain_status, note=excluded.note`,
  ).bind(id, body!.petId, friend.id, loggedOn, weightKg, heartRateBpm, respiratoryRateBpm, stool, appetite, skin, tear, String(body?.note || '').slice(0, 500), jstNow()).run();

  const latest = await c.env.DB.prepare(`SELECT appetite, stool_status FROM nen_health_logs WHERE pet_id = ? ORDER BY logged_on DESC LIMIT 3`).bind(body!.petId).all<{ appetite: string; stool_status: string }>();
  const checks = [
    { type: 'poor_appetite', hit: latest.results.length === 3 && latest.results.every((r) => r.appetite === 'poor') },
    { type: 'abnormal_stool', hit: latest.results.length === 3 && latest.results.every((r) => r.stool_status !== 'normal') },
  ];
  for (const check of checks) {
    if (check.hit) {
      await c.env.DB.prepare(
        `INSERT INTO nen_care_flags (id, pet_id, friend_id, flag_type, status, consecutive_days, advice_ready, detected_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 3, 1, ?, ?)
         ON CONFLICT(pet_id, flag_type) DO UPDATE SET status='active', consecutive_days=3, advice_ready=1, resolved_at=NULL, updated_at=excluded.updated_at`,
      ).bind(crypto.randomUUID(), body!.petId, friend.id, check.type, jstNow(), jstNow()).run();
      await c.env.DB.prepare(`UPDATE nen_health_logs SET care_flag = 1 WHERE pet_id = ? AND logged_on = ?`).bind(body!.petId, loggedOn).run();
    }
  }
  await syncNenHealthTags(c.env.DB, friend.id);
  return c.json({ success: true, data: { careRequired: checks.some((v) => v.hit) } }, 201);
});

nenMembers.get('/api/liff/nen/health-logs', async (c) => {
  const friend = await currentFriend(c);
  if (!friend) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const rows = await c.env.DB.prepare(`SELECT * FROM nen_health_logs WHERE friend_id = ? ORDER BY logged_on DESC LIMIT 730`).bind(friend.id).all<Record<string, unknown>>();
  return c.json({ success: true, data: rows.results });
});

nenMembers.post('/api/liff/nen/photos', async (c) => {
  const friend = await currentFriend(c);
  if (!friend) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ petId?: string; data?: string; mimeType?: string; caption?: string }>().catch(() => null);
  const pet = await c.env.DB.prepare(`SELECT id FROM nen_pet_profiles WHERE id = ? AND friend_id = ?`).bind(body?.petId || '', friend.id).first();
  if (!pet || !body?.data || !body.mimeType || !IMAGE_TYPES[body.mimeType]) return c.json({ success: false, error: '画像またはペットを確認してください' }, 400);
  const raw = body.data.replace(/^data:[^;]+;base64,/, '');
  if (raw.length > 11_200_000) return c.json({ success: false, error: '画像は8MB以下にしてください' }, 400);
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0)); } catch { return c.json({ success: false, error: '画像を読み込めません' }, 400); }
  if (bytes.byteLength > 8 * 1024 * 1024) return c.json({ success: false, error: '画像は8MB以下にしてください' }, 400);
  const id = crypto.randomUUID();
  const key = `nen-pets/${friend.id}/${id}.${IMAGE_TYPES[body.mimeType]}`;
  await c.env.IMAGES.put(key, bytes, { httpMetadata: { contentType: body.mimeType }, customMetadata: { friendId: friend.id, petId: body.petId || '' } });
  const imageUrl = `${c.env.WORKER_PUBLIC_URL || new URL(c.req.url).origin}/images/${key}`;
  const now = jstNow();
  await c.env.DB.prepare(`INSERT INTO nen_photo_submissions (id, friend_id, pet_id, r2_key, image_url, content_type, caption, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .bind(id, friend.id, body.petId, key, imageUrl, body.mimeType, String(body.caption || '').trim().slice(0, 300), now, now).run();
  await syncNenPhotoTags(c.env.DB, friend.id);
  return c.json({ success: true, data: { id, imageUrl, status: 'pending' } }, 201);
});

type KnowledgeMeta = { id: string; title: string; animal_type: string; tags_json: string; source_name: string; authority_rank: number };
type KnowledgeArticle = KnowledgeMeta & { source_url: string; body: string; source_kind: string; language: string };

function questionKeywords(question: string, detected: string[]) {
  const direct = ['食欲','食いつき','ご飯','フード','下痢','軟便','便秘','嘔吐','咳','呼吸','涙','目やに','耳','皮膚','毛','アレルギー','口臭','歯','留守番','吠える','噛む','トイレ','散歩','震える','水','体重']
    .filter((keyword) => question.includes(keyword));
  return [...new Set([...direct, ...detected.flatMap((value) => value.split(/[・]/))])].slice(0, 10);
}

function knowledgeScore(row: KnowledgeMeta, keywords: string[], detected: string[]) {
  const tags = JSON.parse(row.tags_json || '[]') as string[];
  let score = detected.filter((tag) => tags.some((sourceTag) => sourceTag.includes(tag) || tag.includes(sourceTag))).length * 8;
  for (const keyword of keywords) if (row.title.includes(keyword)) score += 6;
  return score + Math.floor(Number(row.authority_rank || 40) / 10);
}

function knowledgeExcerpt(body: string, keywords: string[]) {
  const normalized = body.replace(/\s+/g, ' ').trim();
  const found = keywords.map((keyword) => normalized.toLowerCase().indexOf(keyword.toLowerCase())).filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (found === undefined) return normalized.slice(0, 2200);
  const start = Math.max(0, found - 550);
  return normalized.slice(start, start + 2400);
}

function diverseKnowledge(rows: Array<{ article: KnowledgeArticle; score: number }>, limit = 5) {
  const selected: KnowledgeArticle[] = [];
  const sourceCounts = new Map<string, number>();
  for (const { article } of rows) {
    if ((sourceCounts.get(article.source_name) || 0) >= 2) continue;
    selected.push(article);
    sourceCounts.set(article.source_name, (sourceCounts.get(article.source_name) || 0) + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function aiText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const value = result as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  if (typeof value.response === 'string') return value.response.trim();
  const content = value.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

async function assignConsultationTags(c: Context<Env>, friendId: string, animalType: 'dog' | 'cat', detected: string[]) {
  const names = [`AI相談：${animalType === 'dog' ? 'わんちゃん' : 'ねこちゃん'}`, ...detected.map((tag) => `AI相談：${tag}`)];
  for (const name of names) {
    await c.env.DB.prepare(`INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES (?, ?, '#16815B', ?)`)
      .bind(crypto.randomUUID(), name, jstNow()).run();
    const tag = await c.env.DB.prepare(`SELECT id FROM tags WHERE name = ?`).bind(name).first<{ id: string }>();
    if (tag) await attachTagAndFireSideEffects(c.env.DB, friendId, tag.id);
  }
  return names;
}

nenMembers.post('/api/liff/nen/consultations', async (c) => {
  const friend = await currentFriend(c);
  if (!friend) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const body = await c.req.json<{ animalType?: string; petId?: string; question?: string }>().catch(() => null);
  const question = String(body?.question || '').replace(/\s+/g, ' ').trim();
  const animalType = body?.animalType === 'cat' ? 'cat' : body?.animalType === 'dog' ? 'dog' : null;
  if (!animalType || question.length < 8 || question.length > 1000) return c.json({ success: false, error: '8〜1000文字で相談内容を入力してください' }, 400);
  if (body?.petId) {
    const owned = await c.env.DB.prepare(`SELECT id, animal_type FROM nen_pet_profiles WHERE id = ? AND friend_id = ?`).bind(body.petId, friend.id).first<{ id: string; animal_type: string }>();
    if (!owned) return c.json({ success: false, error: 'Pet not found' }, 404);
    if (owned.animal_type !== animalType) return c.json({ success: false, error: '選択したペットの種別をご確認ください' }, 400);
  }

  const detected: string[] = CONSULTATION_TAG_RULES.filter((rule) => rule.pattern.test(question)).map((rule) => rule.key);
  if (!detected.length) detected.push('その他');
  const safetyLevel = URGENT_PATTERN.test(question) ? 'urgent' : CAUTION_PATTERN.test(question) ? 'caution' : 'general';
  const keywords = questionKeywords(question, detected);
  const metadata = await c.env.DB.prepare(`SELECT id, title, animal_type, tags_json, source_name, authority_rank FROM nen_knowledge_articles WHERE is_active=1 AND animal_type IN (?, 'all')`).bind(animalType).all<KnowledgeMeta>();
  const candidateIds = metadata.results
    .map((row) => ({ row, score: knowledgeScore(row, keywords, detected) }))
    .sort((a, b) => b.score - a.score || b.row.id.localeCompare(a.row.id, 'ja', { numeric: true }))
    .slice(0, 24).map(({ row }) => row.id);
  const placeholders = candidateIds.map(() => '?').join(',');
  const candidates = candidateIds.length
    ? (await c.env.DB.prepare(`SELECT id, title, animal_type, tags_json, source_name, source_url, source_kind, authority_rank, language, body FROM nen_knowledge_articles WHERE id IN (${placeholders})`).bind(...candidateIds).all<KnowledgeArticle>()).results
    : [];
  const rankedSources = candidates
    .map((article) => ({ article, score: knowledgeScore(article, keywords, detected) + keywords.filter((keyword) => article.body.includes(keyword)).length * 2 }))
    .sort((a, b) => b.score - a.score || b.article.authority_rank - a.article.authority_rank);
  const sources = diverseKnowledge(rankedSources);

  let advice = '';
  if (safetyLevel === 'urgent') {
    advice = '心配な状態です。今すぐ、かかりつけまたは夜間対応の動物病院へ電話し、受診してください。移動までの間は無理に食べ物や水、薬を与えず、呼吸や意識の状態、症状が始まった時刻を記録してください。AI相談の回答を待って様子を見る状況ではありません。';
  } else if (c.env.AI && sources.length) {
    const context = sources.map((source, index) => `参考${index + 1}: ${source.title}\n発行主体: ${source.source_name}\n信頼度: ${source.authority_rank}/100\n${knowledgeExcerpt(source.body, keywords)}\n出典: ${source.source_url}`).join('\n\n');
    try {
      const result = await (c.env.AI.run as (model: string, input: unknown) => Promise<unknown>)('@cf/zai-org/glm-4.7-flash', { messages: [
        { role: 'system', content: 'あなたは然-NEN-の犬猫の暮らし相談AIです。獣医師ではなく診断・治療・投薬指示をしません。与えられたNENナレッジだけを根拠に、やさしく具体的な日本語で回答してください。最初に相談への共感、次に考えられる見方、家庭で安全に確認できること、最後に受診の目安を示します。断定せず、参考資料にない内容を作らないでください。緊急性が疑われる場合は受診を最優先にしてください。500文字以内。' },
        { role: 'user', content: `対象: ${animalType === 'dog' ? 'わんちゃん' : 'ねこちゃん'}\n相談: ${question}\n\nNENナレッジ:\n${context}` },
      ], temperature: 0.2, max_completion_tokens: 700 });
      advice = aiText(result);
    } catch (error) {
      console.error('NEN consultation AI failed', error);
    }
  }
  if (!advice) advice = `ご相談ありがとうございます。まず、いつから・どのくらいの頻度か、食欲・元気・排泄など普段との違いを記録してみてください。${safetyLevel === 'caution' ? '症状が続く、悪化する、別の症状も出る場合は、早めに動物病院へご相談ください。' : '気になる状態が続く場合は、無理に自己判断せず動物病院へご相談ください。'}`;

  const tags = await assignConsultationTags(c, friend.id, animalType, detected);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO nen_consultation_logs_v2
    (id, friend_id, pet_id, animal_type, topic, question_text, answers_json, result_key, result_text, tag_name, tags_json, source_ids_json, safety_level, created_at)
    VALUES (?, ?, ?, ?, 'free_text', ?, '[]', 'nen_ai', ?, ?, ?, ?, ?, ?)`)
    .bind(id, friend.id, body?.petId || null, animalType, question, advice, tags[0], JSON.stringify(tags), JSON.stringify(sources.map((source) => source.id)), safetyLevel, jstNow()).run();
  return c.json({ success: true, data: { id, advice, tags, safetyLevel, sources: sources.map((source) => ({ title: source.title, url: source.source_url, source: source.source_name })) } }, 201);
});

// Admin APIs
async function adminAccountScope(c: Context<Env>) {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const where = scope.allowedAccountIds.length
    ? `AND (f.line_account_id IN (${scope.allowedAccountIds.map(() => '?').join(',')})${scope.canSeeUnassigned ? ' OR f.line_account_id IS NULL' : ''})`
    : scope.canSeeUnassigned
      ? 'AND f.line_account_id IS NULL'
      : 'AND 1 = 0';
  return { scope, where };
}

nenMembers.get('/api/nen-members/overview', async (c) => {
  const { scope, where: accountWhere } = await adminAccountScope(c);
  const countScoped = async (table: string, alias: string, extra = '') =>
    c.env.DB.prepare(
      `SELECT COUNT(*) count FROM ${table} ${alias}
       JOIN friends f ON f.id = ${alias}.friend_id
       WHERE 1 = 1 ${extra} ${accountWhere}`,
    ).bind(...scope.allowedAccountIds).first<{ count: number }>();
  const [pets, logs, care, photos, members, consultations] = await Promise.all([
    countScoped('nen_pet_profiles', 'p'),
    countScoped('nen_health_logs', 'h'),
    countScoped('nen_care_flags', 'cf', `AND cf.status='active'`),
    countScoped('nen_photo_submissions', 'ps', `AND ps.status='pending'`),
    countScoped('nen_ec_member_snapshots', 's'),
    countScoped('nen_consultation_logs_v2', 'cl'),
  ]);
  return c.json({ success: true, data: { pets: pets?.count || 0, healthLogs: logs?.count || 0, activeCare: care?.count || 0, pendingPhotos: photos?.count || 0, members: members?.count || 0, consultations: consultations?.count || 0 } });
});

nenMembers.get('/api/nen-members/care-flags', async (c) => {
  const { scope, where } = await adminAccountScope(c);
  const rows = await c.env.DB.prepare(`SELECT cf.*, p.name pet_name, f.display_name owner_name FROM nen_care_flags cf JOIN nen_pet_profiles p ON p.id=cf.pet_id JOIN friends f ON f.id=cf.friend_id WHERE 1 = 1 ${where} ORDER BY cf.status='active' DESC, cf.detected_at DESC LIMIT 200`).bind(...scope.allowedAccountIds).all<Record<string, unknown>>();
  return c.json({ success: true, data: rows.results });
});

nenMembers.put('/api/nen-members/care-flags/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  const body = await c.req.json<{ status?: string; adviceReady?: boolean }>().catch(() => null);
  if (!body || !['active', 'resolved'].includes(String(body.status))) return c.json({ success: false, error: 'Invalid status' }, 400);
  const flag = await c.env.DB.prepare(`SELECT cf.friend_id, f.line_account_id FROM nen_care_flags cf JOIN friends f ON f.id=cf.friend_id WHERE cf.id=?`)
    .bind(c.req.param('id')).first<{ friend_id: string; line_account_id: string | null }>();
  if (!flag || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [flag.line_account_id])) return c.json({ success: false, error: 'Not found' }, 404);
  await c.env.DB.prepare(`UPDATE nen_care_flags SET status=?, advice_ready=?, resolved_at=CASE WHEN ?='resolved' THEN ? ELSE NULL END, updated_at=? WHERE id=?`)
    .bind(body.status, body.adviceReady === false ? 0 : 1, body.status, jstNow(), jstNow(), c.req.param('id')).run();
  await syncNenHealthTags(c.env.DB, flag.friend_id);
  return c.json({ success: true });
});

nenMembers.get('/api/nen-members/photos', async (c) => {
  const { scope, where } = await adminAccountScope(c);
  const rows = await c.env.DB.prepare(`SELECT ps.*, p.name pet_name, f.display_name owner_name FROM nen_photo_submissions ps JOIN nen_pet_profiles p ON p.id=ps.pet_id JOIN friends f ON f.id=ps.friend_id WHERE 1 = 1 ${where} ORDER BY ps.created_at DESC LIMIT 200`).bind(...scope.allowedAccountIds).all<Record<string, unknown>>();
  return c.json({ success: true, data: rows.results });
});

nenMembers.put('/api/nen-members/photos/:id/review', requireRole('owner', 'admin', 'staff'), async (c) => {
  const body = await c.req.json<{ status?: string; points?: number }>().catch(() => null);
  const status = String(body?.status || '');
  if (!['adopted', 'rejected'].includes(status)) return c.json({ success: false, error: 'Invalid review' }, 400);
  const photo = await c.env.DB.prepare(`SELECT ps.*, s.customer_id, f.line_account_id
    FROM nen_photo_submissions ps JOIN friends f ON f.id = ps.friend_id LEFT JOIN nen_ec_member_snapshots s ON s.friend_id = ps.friend_id
    WHERE ps.id=?`).bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!photo || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [photo.line_account_id as string | null])) return c.json({ success: false, error: 'Not found' }, 404);
  if (photo.status !== 'pending') return c.json({ success: false, error: 'Already reviewed' }, 409);
  let awarded = 0;
  let pointBalance: number | null = null;
  if (status === 'adopted') {
    if (!c.env.NEN_EC_BASE_URL || !c.env.ECCUBE_WEBHOOK_SECRET || !photo.customer_id) {
      return c.json({ success: false, error: 'ECポイント連携が設定されていません' }, 503);
    }
    const payload = JSON.stringify({
      customerId: String(photo.customer_id),
      awardKey: `nen-photo:${String(photo.id)}`,
      points: PHOTO_ADOPTION_POINTS,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(c.env.ECCUBE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`))))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const response = await fetch(`${c.env.NEN_EC_BASE_URL.replace(/\/$/, '')}/line-harness/photo-points`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nen-Timestamp': timestamp, 'X-Nen-Signature': `sha256=${signature}` }, body: payload,
    });
    const result = await response.json().catch(() => ({})) as { success?: boolean; pointBalance?: number; error?: string };
    if (!response.ok || !result.success) return c.json({ success: false, error: result.error || 'ECポイントを付与できませんでした' }, 502);
    awarded = PHOTO_ADOPTION_POINTS;
    pointBalance = Number(result.pointBalance || 0);
  }
  await c.env.DB.prepare(`UPDATE nen_photo_submissions SET status=?, awarded_points=?, reviewed_at=?, updated_at=? WHERE id=? AND status='pending'`)
    .bind(status, awarded, jstNow(), jstNow(), c.req.param('id')).run();
  if (pointBalance !== null) {
    await c.env.DB.prepare(`UPDATE nen_ec_member_snapshots SET point_balance=?, synced_at=? WHERE friend_id=?`)
      .bind(pointBalance, jstNow(), photo.friend_id).run();
    await c.env.DB.prepare(`INSERT OR IGNORE INTO nen_point_ledger (id, friend_id, amount, balance_after, reason, external_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), photo.friend_id, awarded, pointBalance, '写真採用', `nen-photo:${String(photo.id)}`, jstNow()).run();
  }
  await syncNenPhotoTags(c.env.DB, String(photo.friend_id));
  return c.json({ success: true, data: { awardedPoints: awarded, pointBalance, pointSync: status === 'adopted' ? 'synced' : 'not_required' } });
});

nenMembers.post('/api/nen-members/tags/resync', requireRole('owner', 'admin'), async (c) => {
  const body: { limit?: number } = await c.req.json<{ limit?: number }>().catch(() => ({}));
  const limit = Number.isFinite(body.limit) ? Number(body.limit) : 500;
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const result = await refreshAllNenTags(c.env.DB, [
    ...scope.allowedAccountIds,
    ...(scope.canSeeUnassigned ? [null] : []),
  ], limit);
  return c.json({ success: true, data: result });
});

nenMembers.get('/api/nen-members/friends/:friendId', async (c) => {
  const friendId = c.req.param('friendId');
  const friend = await c.env.DB.prepare(
    `SELECT f.id, f.line_user_id, f.display_name, f.picture_url, f.is_following,
            f.created_at, f.updated_at, f.line_account_id, la.name AS line_account_name
       FROM friends f
       LEFT JOIN line_accounts la ON la.id = f.line_account_id
      WHERE f.id = ?`,
  ).bind(friendId).first<Record<string, unknown>>();
  if (!friend || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [friend.line_account_id as string | null])) return c.json({ success: false, error: 'Friend not found' }, 404);

  const [member, pets, healthLogs, photos, pointLedger, ecEvents] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM nen_ec_member_snapshots WHERE friend_id = ?`).bind(friendId).first<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT * FROM nen_pet_profiles WHERE friend_id = ? ORDER BY created_at ASC`).bind(friendId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT * FROM nen_health_logs WHERE friend_id = ? ORDER BY logged_on DESC LIMIT 100`).bind(friendId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT ps.*, p.name AS pet_name FROM nen_photo_submissions ps LEFT JOIN nen_pet_profiles p ON p.id = ps.pet_id WHERE ps.friend_id = ? ORDER BY ps.created_at DESC LIMIT 100`).bind(friendId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT * FROM nen_point_ledger WHERE friend_id = ? ORDER BY created_at DESC LIMIT 100`).bind(friendId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT id, source, external_event_id, event_type, customer_id, status, error_message, received_at, processed_at FROM ec_events WHERE friend_id = ? ORDER BY received_at DESC LIMIT 100`).bind(friendId).all<Record<string, unknown>>(),
  ]);

  return c.json({
    success: true,
    data: {
      friend,
      member: member || null,
      pets: pets.results,
      healthLogs: healthLogs.results,
      photos: photos.results,
      pointLedger: pointLedger.results,
      ecEvents: ecEvents.results,
    },
  });
});

nenMembers.get('/api/nen-members/ranks', async (c) => {
  const { scope, where } = await adminAccountScope(c);
  const rows = await c.env.DB.prepare(`SELECT s.*, f.display_name, f.line_user_id FROM nen_ec_member_snapshots s JOIN friends f ON f.id=s.friend_id WHERE 1 = 1 ${where} ORDER BY s.purchase_amount DESC LIMIT 300`).bind(...scope.allowedAccountIds).all<Record<string, unknown>>();
  return c.json({ success: true, data: rows.results });
});

nenMembers.get('/api/nen-members/consultations', async (c) => {
  const { scope, where } = await adminAccountScope(c);
  const rows = await c.env.DB.prepare(`SELECT cl.*, p.name pet_name, f.display_name owner_name FROM nen_consultation_logs_v2 cl LEFT JOIN nen_pet_profiles p ON p.id=cl.pet_id JOIN friends f ON f.id=cl.friend_id WHERE 1 = 1 ${where} ORDER BY cl.created_at DESC LIMIT 300`).bind(...scope.allowedAccountIds).all<Record<string, unknown>>();
  return c.json({ success: true, data: rows.results });
});

nenMembers.post('/api/nen-members/rich-menu/install', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ accountId?: string }>().catch(() => null);
  if (!body?.accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  try {
    const result = await installNenRichMenu(c.env, body.accountId);
    return c.json({ success: true, data: result }, 201);
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 409);
  }
});

export { nenMembers };
