import { Hono, type Context } from 'hono';
import type { Message } from '@line-crm/line-sdk';
import {
  claimPhotoNotificationDelivery,
  completePhotoNotificationDelivery,
  getFriendByLineUserIdForAccount,
  getPhotoNotificationState,
  jstNow,
  resolveLineCredential,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { requirePhotoPermission } from './nen-photo-operations.js';
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
const PHOTO_REVIEW_REASON_LABELS = {
  quality: '写真が暗い・ぼやけている',
  privacy: '人の顔や個人情報が写っている',
  unrelated: 'ペットと関係のない内容が写っている',
  duplicate: '同じ写真がすでに投稿されている',
  other: 'そのほか',
} as const;
export type PhotoReviewReasonCode = keyof typeof PHOTO_REVIEW_REASON_LABELS;

function detectedImageMime(bytes: Uint8Array): keyof typeof IMAGE_TYPES | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
      && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a
      && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

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

export type ReviewPhotoRow = Record<string, unknown> & {
  id: string;
  friend_id: string;
  line_user_id: string;
  line_account_id: string;
  is_following: number;
  channel_access_token: string | null;
  channel_access_token_encrypted: string | null;
};

function photoReviewMessage(
  status: 'adopted' | 'rejected',
  reasonCode: PhotoReviewReasonCode | null,
  reasonNote: string | null,
): string {
  if (status === 'adopted') {
    return [
      'お写真をご投稿いただきありがとうございます。',
      '今回のお写真を採用し、5ポイントを付ける手続きを始めました。',
      '公開への同意をいただいている場合だけ、公開ギャラリーへ掲載します。',
    ].join('\n');
  }
  const reason = reasonCode ? PHOTO_REVIEW_REASON_LABELS[reasonCode] : PHOTO_REVIEW_REASON_LABELS.other;
  return [
    'お写真をご投稿いただきありがとうございます。',
    `今回は「${reason}」のため、掲載を見送らせていただきました。`,
    ...(reasonNote ? [reasonNote] : []),
    '内容をご確認のうえ、よろしければ別のお写真をご投稿ください。',
  ].join('\n');
}

export async function sendPhotoReviewNotification(
  c: Context<Env>,
  photo: ReviewPhotoRow,
  status: 'adopted' | 'rejected',
  reasonCode: PhotoReviewReasonCode | null,
  reasonNote: string | null,
  decisionId: string,
): Promise<void> {
  if (!photo.is_following) throw new Error('LINEの友だちではないため通知できません');
  const accessToken = await resolveLineCredential(
    photo.channel_access_token_encrypted,
    photo.channel_access_token,
    { lineAccountId: photo.line_account_id, field: 'channel_access_token' },
  );
  const message = photoReviewMessage(status, reasonCode, reasonNote);
  await pushViaHarnessProxy(
    c.env.WORKER_PUBLIC_URL || new URL(c.req.url).origin,
    accessToken,
    photo.line_user_id,
    [{ type: 'text', text: message }],
    `nen-photo-review:${decisionId}`,
    (request) => dispatchLineProxyLocally(request, c.env, c.executionCtx),
  );
}

/**
 * 通知先の1行を取る。単票・一括どちらも同じ絞り込み
 *（写真ID＋LINEアカウント＋友だちの所属アカウント）で、他アカウントへは届けない。
 */
export async function loadPhotoReviewRecipient(
  db: D1Database,
  input: { photoId: string; lineAccountId: string },
): Promise<ReviewPhotoRow | null> {
  return db.prepare(
    `SELECT ps.*, s.customer_id, f.line_user_id, f.line_account_id, f.is_following,
            a.channel_access_token, a.channel_access_token_encrypted
       FROM nen_photo_submissions ps
       JOIN friends f ON f.id = ps.friend_id
       JOIN line_accounts a ON a.id = f.line_account_id
       LEFT JOIN nen_ec_member_snapshots s ON s.friend_id = ps.friend_id
      WHERE ps.id = ? AND ps.line_account_id = ? AND f.line_account_id = ?`,
  ).bind(input.photoId, input.lineAccountId, input.lineAccountId).first<ReviewPhotoRow>();
}

/**
 * 通知leaseの有効期間。確定に失敗した送信中は、切れた後に同じ安定keyで
 * 再送・再照合できる（送達状態機械）。
 */
export const PHOTO_NOTIFICATION_LEASE_TTL_MS = 5 * 60 * 1000;

export async function mirrorReviewNotificationStatus(
  db: D1Database,
  input: { photoId: string; lineAccountId: string; status: 'pending' | 'sent' | 'failed'; now?: string },
): Promise<void> {
  try {
    await db.prepare(
      `UPDATE nen_photo_submissions SET review_notification_status = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ?`,
    ).bind(
      input.status, input.now ?? new Date().toISOString(), input.photoId, input.lineAccountId,
    ).run();
  } catch (error) {
    console.error('mirror review notification status failed', input.photoId, error);
  }
}

/*
 * 通知の送達オーケストレーション。claim→送信（安定key）→世代条件付き確定。
 * 確定に失敗したら送達不明のまま残し、lease切れ後の再送で復旧できる。
 * relayed は今回の呼び出しが実際に送信したかどうか。
 */
export async function deliverPhotoReviewNotification(
  db: D1Database,
  c: Context<Env>,
  recipient: ReviewPhotoRow,
  input: {
    lineAccountId: string;
    photoId: string;
    status: 'adopted' | 'rejected';
    reasonCode: PhotoReviewReasonCode | null;
    reasonNote: string | null;
    decisionId: string;
  },
): Promise<{ notificationStatus: 'sent' | 'failed'; notificationError: string | null; busy: boolean; relayed: boolean }> {
  const now = new Date().toISOString();
  const claimed = await claimPhotoNotificationDelivery(db, {
    decisionId: input.decisionId, lineAccountId: input.lineAccountId,
    leaseId: crypto.randomUUID(),
    leaseExpiresAt: new Date(Date.now() + PHOTO_NOTIFICATION_LEASE_TTL_MS).toISOString(),
    now,
  });
  if (!claimed) {
    const state = await getPhotoNotificationState(db, {
      decisionId: input.decisionId, lineAccountId: input.lineAccountId,
    }).catch(() => null);
    if (state?.status === 'sent') {
      await mirrorReviewNotificationStatus(db, {
        photoId: input.photoId, lineAccountId: input.lineAccountId, status: 'sent',
      });
      return { notificationStatus: 'sent', notificationError: null, busy: false, relayed: false };
    }
    if (state?.status === 'sending') {
      return {
        notificationStatus: 'failed', busy: true, relayed: false,
        notificationError: 'ほかの処理が通知を実行中です。しばらくしてから再送してください。',
      };
    }
    return {
      notificationStatus: 'failed', busy: false, relayed: false,
      notificationError: '通知の送信権を確保できませんでした。再送してください。',
    };
  }
  let sendError: string | null = null;
  let relayed = false;
  try {
    await sendPhotoReviewNotification(
      c, recipient, input.status, input.reasonCode, input.reasonNote, input.decisionId,
    );
    relayed = true;
  } catch (error) {
    sendError = error instanceof Error ? error.message : '審査結果をLINEで通知できませんでした';
  }
  try {
    const completed = await completePhotoNotificationDelivery(db, {
      decisionId: input.decisionId, lineAccountId: input.lineAccountId,
      generation: claimed.generation, status: sendError ? 'failed' : 'sent', error: sendError,
    });
    if (completed) {
      const finalStatus = sendError ? 'failed' : 'sent';
      await mirrorReviewNotificationStatus(db, {
        photoId: input.photoId, lineAccountId: input.lineAccountId, status: finalStatus,
      });
      return { notificationStatus: finalStatus, notificationError: sendError, busy: false, relayed };
    }
  } catch (error) {
    console.error('complete photo notification failed', input.decisionId, error);
  }
  const state = await getPhotoNotificationState(db, {
    decisionId: input.decisionId, lineAccountId: input.lineAccountId,
  }).catch(() => null);
  if (state?.status === 'sent') {
    await mirrorReviewNotificationStatus(db, {
      photoId: input.photoId, lineAccountId: input.lineAccountId, status: 'sent',
    });
    return { notificationStatus: 'sent', notificationError: null, busy: false, relayed };
  }
  return {
    notificationStatus: 'failed', busy: false, relayed,
    notificationError: '送達の記録を確定できませんでした。しばらくしてから再送してください。',
  };
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
    c.env.DB.prepare(`SELECT ps.id, ps.pet_id, ps.image_url, ps.caption, ps.status, ps.awarded_points,
      ps.publication_consent_at, ps.publication_withdrawn_at, ps.public_pet_name,
      ps.created_at, p.name pet_name
      FROM nen_photo_submissions ps JOIN nen_pet_profiles p ON p.id = ps.pet_id
      WHERE ps.friend_id = ? AND ps.status = 'adopted'
      ORDER BY ps.reviewed_at DESC, ps.created_at DESC LIMIT 30`).bind(friend.id).all<Record<string, unknown>>(),
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
    photos: photos.results.map((r) => ({
      id: r.id, petId: r.pet_id, petName: r.pet_name, imageUrl: r.image_url,
      caption: r.caption, status: r.status, awardedPoints: r.awarded_points,
      publicationConsent: Boolean(r.publication_consent_at) && !r.publication_withdrawn_at,
      publicPetName: r.public_pet_name === 1,
      createdAt: r.created_at,
    })),
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
  const lineAccountId = c.req.query('lineAccountId')?.trim();
  if (!lineAccountId) return c.json({ success: false, error: 'lineAccountId is required' }, 400);
  const rows = await c.env.DB.prepare(`SELECT ps.id, ps.public_image_url AS image_url, ps.caption, ps.reviewed_at,
      CASE WHEN ps.public_pet_name = 1 THEN p.name ELSE NULL END pet_name
    FROM nen_photo_submissions ps
    JOIN nen_pet_profiles p ON p.id = ps.pet_id
    JOIN friends f ON f.id = ps.friend_id
    WHERE ps.status = 'adopted'
      AND ps.line_account_id = ? AND f.line_account_id = ?
      AND ps.publication_consent_at IS NOT NULL
      AND ps.publication_withdrawn_at IS NULL
      AND ps.public_image_url IS NOT NULL
    ORDER BY ps.reviewed_at DESC, ps.created_at DESC LIMIT 24`)
    .bind(lineAccountId, lineAccountId).all<Record<string, unknown>>();
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
  if (detectedImageMime(bytes) !== body.mimeType) {
    return c.json({ success: false, error: '画像の内容と形式が一致しません' }, 400);
  }
  const id = crypto.randomUUID();
  const extension = IMAGE_TYPES[body.mimeType];
  const key = `nen-photo-originals/${friend.id}/${id}.${extension}`;
  const reviewKey = `nen-photo-review/${friend.id}/${id}-v1.${extension}`;
  const metadata = { friendId: friend.id, petId: body.petId || '', photoId: id };
  await Promise.all([
    c.env.IMAGES.put(key, bytes, { httpMetadata: { contentType: body.mimeType }, customMetadata: metadata }),
    c.env.IMAGES.put(reviewKey, bytes, { httpMetadata: { contentType: body.mimeType }, customMetadata: { ...metadata, derivative: 'review-v1' } }),
  ]);
  const reviewImageUrl = `${c.env.WORKER_PUBLIC_URL || new URL(c.req.url).origin}/images/${reviewKey}`;
  const now = jstNow();
  await c.env.DB.prepare(`INSERT INTO nen_photo_submissions
    (id, friend_id, pet_id, r2_key, image_url, content_type, caption, status,
     created_at, updated_at, line_account_id, review_image_url, image_byte_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`)
    .bind(
      id, friend.id, body.petId, key, reviewImageUrl, body.mimeType,
      String(body.caption || '').trim().slice(0, 300), now, now, friend.line_account_id,
      reviewImageUrl, bytes.byteLength,
    ).run();
  await syncNenPhotoTags(c.env.DB, friend.id);
  return c.json({ success: true, data: { id, imageUrl: reviewImageUrl, status: 'pending' } }, 201);
});

nenMembers.put('/api/liff/nen/photos/:id/publication-consent', async (c) => {
  const friend = await currentFriend(c);
  if (!friend) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const body = await c.req.json<{
    consent?: boolean;
    consentVersion?: string;
    showPetName?: boolean;
  }>().catch(() => null);
  const consentVersion = typeof body?.consentVersion === 'string'
    ? body.consentVersion.trim().slice(0, 80)
    : '';
  if (typeof body?.consent !== 'boolean' || (body.consent && !consentVersion)) {
    return c.json({ success: false, error: '公開同意の内容を確認してください' }, 400);
  }
  const photo = await c.env.DB.prepare(
    `SELECT id FROM nen_photo_submissions WHERE id = ? AND friend_id = ? AND line_account_id = ?`,
  ).bind(c.req.param('id'), friend.id, friend.line_account_id).first<{ id: string }>();
  if (!photo) return c.json({ success: false, error: 'Not found' }, 404);
  const now = jstNow();
  if (body.consent) {
    await c.env.DB.prepare(
      `UPDATE nen_photo_submissions
          SET publication_consent_version = ?, publication_consent_at = ?,
              publication_withdrawn_at = NULL, public_pet_name = ?, updated_at = ?
        WHERE id = ? AND friend_id = ? AND line_account_id = ?`,
    ).bind(
      consentVersion, now, body.showPetName === true ? 1 : 0, now,
      photo.id, friend.id, friend.line_account_id,
    ).run();
  } else {
    await c.env.DB.prepare(
      `UPDATE nen_photo_submissions
          SET publication_withdrawn_at = ?, public_pet_name = 0, updated_at = ?
        WHERE id = ? AND friend_id = ? AND line_account_id = ?`,
    ).bind(now, now, photo.id, friend.id, friend.line_account_id).run();
  }
  return c.json({
    success: true,
    data: { publicationConsent: body.consent, publicPetName: body.consent && body.showPetName === true },
  });
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

nenMembers.get('/api/nen-members/photos', requirePhotoPermission('photo.submission.view'), async (c) => {
  const accountId = c.req.query('accountId')?.trim();
  if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
  }
  const rows = await c.env.DB.prepare(
    `SELECT ps.id, ps.friend_id, ps.pet_id, ps.review_image_url AS image_url,
            ps.caption, ps.status, ps.awarded_points, ps.created_at, ps.reviewed_at,
            ps.updated_at, ps.review_version, ps.publication_consent_at,
            ps.publication_withdrawn_at, ps.public_pet_name, ps.review_reason_code,
            ps.review_reason_note, ps.review_notification_status,
            p.name pet_name, f.display_name owner_name,
            (SELECT r.flag FROM nen_photo_risk_assessments r
              WHERE r.photo_id = ps.id AND r.line_account_id = ps.line_account_id
              ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS latest_risk_flag,
            (SELECT r.confidence FROM nen_photo_risk_assessments r
              WHERE r.photo_id = ps.id AND r.line_account_id = ps.line_account_id
              ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS latest_risk_confidence,
            CASE WHEN EXISTS (
              SELECT 1 FROM nen_photo_asset_jobs j
               WHERE j.photo_id = ps.id AND j.line_account_id = ps.line_account_id AND j.status = 'failed'
            ) THEN 1 ELSE 0 END AS has_failed_asset_job
       FROM nen_photo_submissions ps
       JOIN nen_pet_profiles p ON p.id = ps.pet_id
       JOIN friends f ON f.id = ps.friend_id
      WHERE ps.line_account_id = ? AND f.line_account_id = ?
      ORDER BY ps.created_at DESC LIMIT 200`,
  ).bind(accountId, accountId).all<Record<string, unknown>>();
  return c.json({ success: true, data: rows.results });
});

nenMembers.get(
  '/api/nen-members/photos/publications',
  requirePhotoPermission('photo.submission.view'),
  async (c) => {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const rows = await c.env.DB.prepare(
      `SELECT pub.id, pub.photo_id, pub.status, pub.show_owner_name, pub.view_count,
              pub.version, pub.published_at, ps.public_image_url AS image_url,
              ps.publication_consent_at, p.name AS pet_name,
              CASE WHEN pub.show_owner_name = 1 THEN f.display_name ELSE NULL END AS owner_name
         FROM nen_photo_publications pub
         JOIN nen_photo_submissions ps ON ps.id = pub.photo_id AND ps.line_account_id = pub.line_account_id
         JOIN nen_pet_profiles p ON p.id = ps.pet_id
         JOIN friends f ON f.id = ps.friend_id AND f.line_account_id = pub.line_account_id
        WHERE pub.line_account_id = ? AND pub.status = 'published'
          AND ps.status = 'adopted' AND ps.publication_consent_at IS NOT NULL
          AND ps.publication_withdrawn_at IS NULL
        ORDER BY pub.published_at DESC LIMIT 200`,
    ).bind(accountId).all<Record<string, unknown>>();
    /*
     * 掲載先は1発で取る。写真ごとに1件ずつ取りに行くと、掲載数が増えるほど
     * 遅くなる（N+1）。表示の形は変えない。
     */
    const publicationIds = rows.results.map((row) => String(row.id));
    const placementRows = publicationIds.length === 0 ? [] : (await c.env.DB.prepare(
      `SELECT publication_id, id, placement_type, placement_label, view_count
         FROM nen_photo_publication_placements
        WHERE publication_id IN (${publicationIds.map(() => '?').join(',')})
          AND line_account_id = ? AND active = 1
        ORDER BY created_at`,
    ).bind(...publicationIds, accountId).all<Record<string, unknown>>()).results;
    const placementsByPublication = new Map<string, Array<Record<string, unknown>>>();
    for (const placement of placementRows) {
      const key = String(placement.publication_id);
      const list = placementsByPublication.get(key) ?? [];
      // 返す列は従来どおり4つ（publication_id は振り分け用で返さない）。
      list.push({
        id: placement.id,
        placement_type: placement.placement_type,
        placement_label: placement.placement_label,
        view_count: placement.view_count,
      });
      placementsByPublication.set(key, list);
    }
    const items = rows.results.map((row) => (
      { ...row, placements: placementsByPublication.get(String(row.id)) ?? [] }
    )) as Array<Record<string, unknown> & {
      placements: Array<Record<string, unknown>>;
    }>;
    const measured = items.filter((item) => item.view_count !== null && item.view_count !== undefined);
    return c.json({ success: true, data: {
      summary: {
        publishedCount: items.length,
        placementCount: new Set(items.flatMap((item) => (
          item.placements
        ).map((placement) => `${placement.placement_type}:${placement.placement_label}`))).size,
        topPhoto: measured.length
          ? measured.reduce((top, item) => Number(item.view_count) > Number(top.view_count) ? item : top)
          : null,
        consentedCount: items.length,
      },
      items,
    } });
  },
);

nenMembers.put('/api/nen-members/photos/publications/:id/withdraw', requireRole('owner', 'admin', 'staff'), requirePhotoPermission('photo.submission.review'), async (c) => {
  const body = await c.req.json<{ accountId?: string; expectedVersion?: number }>().catch(() => null);
  const accountId = body?.accountId?.trim();
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim().slice(0, 120);
  if (!accountId || !Number.isInteger(body?.expectedVersion) || !idempotencyKey) {
    return c.json({ success: false, error: 'accountId、expectedVersion、Idempotency-Key は必須です' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  const publication = await c.env.DB.prepare(
    `SELECT id, photo_id, status, version, last_idempotency_key
       FROM nen_photo_publications WHERE id = ? AND line_account_id = ?`,
  ).bind(c.req.param('id'), accountId).first<{
    id: string; photo_id: string; status: string; version: number; last_idempotency_key: string | null;
  }>();
  if (!publication) return c.json({ success: false, error: 'Not found' }, 404);
  if (publication.last_idempotency_key === idempotencyKey) {
    return c.json({ success: true, data: { status: publication.status, version: publication.version } });
  }
  if (publication.status !== 'published' || publication.version !== body!.expectedVersion) {
    return c.json({ success: false, error: '別の人が先に掲載状態を変更しました' }, 409);
  }
  const now = jstNow();
  const reviewer = c.get('staff');
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE nen_photo_publications
          SET status = 'withdrawn', withdrawn_at = ?, withdrawn_by = ?, version = version + 1,
              last_idempotency_key = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND status = 'published' AND version = ?`,
    ).bind(now, reviewer.id, idempotencyKey, now, publication.id, accountId, body!.expectedVersion),
    c.env.DB.prepare(
      `UPDATE nen_photo_publication_placements SET active = 0, removed_at = ?
        WHERE publication_id = ? AND line_account_id = ? AND active = 1`,
    ).bind(now, publication.id, accountId),
    c.env.DB.prepare(
      `UPDATE nen_photo_submissions SET publication_withdrawn_at = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ?`,
    ).bind(now, now, publication.photo_id, accountId),
  ]);
  if (!results[0]?.meta.changes) {
    return c.json({ success: false, error: '別の人が先に掲載状態を変更しました' }, 409);
  }
  return c.json({ success: true, data: { status: 'withdrawn', version: publication.version + 1 } });
});

nenMembers.put('/api/nen-members/photos/publications/:id/placements', requireRole('owner', 'admin', 'staff'), requirePhotoPermission('photo.submission.review'), async (c) => {
  const body = await c.req.json<{
    accountId?: string;
    expectedVersion?: number;
    placements?: Array<{ type?: string; label?: string }>;
  }>().catch(() => null);
  const accountId = body?.accountId?.trim();
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim().slice(0, 120);
  const allowed = new Set(['rich_menu', 'column', 'form', 'site']);
  const placements = (body?.placements ?? []).map((placement) => ({
    type: String(placement.type || ''), label: String(placement.label || '').trim().slice(0, 120),
  }));
  if (!accountId || !Number.isInteger(body?.expectedVersion) || !idempotencyKey
      || placements.length > 20 || placements.some((placement) => !allowed.has(placement.type) || !placement.label)) {
    return c.json({ success: false, error: '掲載先、accountId、expectedVersion、Idempotency-Key を確認してください' }, 400);
  }
  if (new Set(placements.map((placement) => `${placement.type}:${placement.label}`)).size !== placements.length) {
    return c.json({ success: false, error: '同じ掲載先が重複しています' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  const publication = await c.env.DB.prepare(
    `SELECT id, status, version, last_idempotency_key
       FROM nen_photo_publications WHERE id = ? AND line_account_id = ?`,
  ).bind(c.req.param('id'), accountId).first<{
    id: string; status: string; version: number; last_idempotency_key: string | null;
  }>();
  if (!publication) return c.json({ success: false, error: 'Not found' }, 404);
  if (publication.last_idempotency_key === idempotencyKey) {
    return c.json({ success: true, data: { version: publication.version, placementCount: placements.length } });
  }
  if (publication.status !== 'published' || publication.version !== body!.expectedVersion) {
    return c.json({ success: false, error: '別の人が先に掲載先を変更しました' }, 409);
  }
  const now = jstNow();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE nen_photo_publications SET version = version + 1, last_idempotency_key = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND status = 'published' AND version = ?`,
    ).bind(idempotencyKey, now, publication.id, accountId, body!.expectedVersion),
    c.env.DB.prepare(
      `UPDATE nen_photo_publication_placements SET active = 0, removed_at = ?
        WHERE publication_id = ? AND line_account_id = ? AND active = 1`,
    ).bind(now, publication.id, accountId),
    ...placements.map((placement) => c.env.DB.prepare(
      `INSERT INTO nen_photo_publication_placements
        (id, publication_id, line_account_id, placement_type, placement_label, active, created_at, removed_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, NULL)
       ON CONFLICT(publication_id, placement_type, placement_label)
       DO UPDATE SET active = 1, removed_at = NULL`,
    ).bind(crypto.randomUUID(), publication.id, accountId, placement.type, placement.label, now)),
  ]);
  if (!results[0]?.meta.changes) {
    return c.json({ success: false, error: '別の人が先に掲載先を変更しました' }, 409);
  }
  return c.json({ success: true, data: { version: publication.version + 1, placementCount: placements.length } });
});

nenMembers.get('/api/nen-members/photos/:id', requirePhotoPermission('photo.submission.view'), async (c) => {
  const accountId = c.req.query('accountId')?.trim();
  if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
  }
  const photo = await c.env.DB.prepare(
    `SELECT ps.id, ps.review_image_url AS image_url, ps.caption, ps.status,
            ps.image_width, ps.image_height, ps.image_byte_size, ps.captured_device,
            ps.review_version, ps.created_at, ps.publication_consent_at,
            ps.publication_withdrawn_at, p.name AS pet_name, p.animal_type, p.breed,
            p.birthday, f.display_name AS owner_name,
            (SELECT COUNT(*) FROM nen_photo_submissions prior
              WHERE prior.friend_id = ps.friend_id AND prior.created_at <= ps.created_at) AS submission_count,
            (SELECT COUNT(*) FROM nen_photo_submissions returned
              WHERE returned.friend_id = ps.friend_id AND returned.status = 'rejected') AS returned_count
       FROM nen_photo_submissions ps
       JOIN nen_pet_profiles p ON p.id = ps.pet_id
       JOIN friends f ON f.id = ps.friend_id
      WHERE ps.id = ? AND ps.line_account_id = ? AND f.line_account_id = ?`,
  ).bind(c.req.param('id'), accountId, accountId).first<Record<string, unknown>>();
  if (!photo) return c.json({ success: false, error: 'Not found' }, 404);
  const risks = await c.env.DB.prepare(
    `SELECT flag, confidence, note, provider, model_version, assessed_at
       FROM nen_photo_risk_assessments
      WHERE photo_id = ? AND line_account_id = ? ORDER BY created_at DESC`,
  ).bind(c.req.param('id'), accountId).all<Record<string, unknown>>();
  return c.json({ success: true, data: { ...photo, risks: risks.results } });
});

nenMembers.put('/api/nen-members/photos/:id/review', requireRole('owner', 'admin', 'staff'), requirePhotoPermission('photo.submission.review'), async (c) => {
  const body = await c.req.json<{
    accountId?: string;
    status?: string;
    reasonCode?: string;
    reasonNote?: string;
    expectedVersion?: number;
  }>().catch(() => null);
  const accountId = body?.accountId?.trim();
  if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  const status = String(body?.status || '');
  if (!['adopted', 'rejected'].includes(status)) return c.json({ success: false, error: 'Invalid review' }, 400);
  if (!Number.isInteger(body?.expectedVersion)) return c.json({ success: false, error: 'expectedVersion is required' }, 400);
  const reasonCode = status === 'rejected' ? String(body?.reasonCode || '') : '';
  const reasonNote = String(body?.reasonNote || '').trim().slice(0, 500);
  if (status === 'rejected' && !Object.prototype.hasOwnProperty.call(PHOTO_REVIEW_REASON_LABELS, reasonCode)) {
    return c.json({ success: false, error: '見送る理由を選んでください' }, 400);
  }
  if (status === 'rejected' && reasonCode === 'other' && !reasonNote) {
    return c.json({ success: false, error: 'そのほかの理由を入力してください' }, 400);
  }
  const photo = await loadPhotoReviewRecipient(
    c.env.DB, { photoId: c.req.param('id'), lineAccountId: accountId },
  );
  if (!photo) return c.json({ success: false, error: 'Not found' }, 404);
  if (photo.status !== 'pending' || Number(photo.review_version) !== body!.expectedVersion) {
    return c.json({ success: false, error: 'Already reviewed' }, 409);
  }
  const awarded = status === 'adopted' ? PHOTO_ADOPTION_POINTS : 0;
  const pointSync: 'pending' | 'needs_attention' | 'not_required' = status !== 'adopted'
    ? 'not_required'
    : photo.customer_id ? 'pending' : 'needs_attention';
  const now = jstNow();
  const decisionId = crypto.randomUUID();
  try {
    const reviewer = c.get('staff');
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO nen_photo_review_events
          (id, photo_id, line_account_id, from_status, to_status, reason_code, reason_note,
           awarded_points, reviewed_by, reviewed_by_name, notification_status, created_at, updated_at)
         SELECT ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 'pending', ?, ?
           FROM nen_photo_submissions
          WHERE id = ? AND line_account_id = ? AND status = 'pending' AND review_version = ?`,
      ).bind(
        decisionId, c.req.param('id'), accountId, status, reasonCode || null, reasonNote || null,
        awarded, reviewer.id, reviewer.name, now, now, c.req.param('id'), accountId, body!.expectedVersion,
      ),
      c.env.DB.prepare(
        `UPDATE nen_photo_submissions
            SET status = ?, awarded_points = ?, review_reason_code = ?, review_reason_note = ?,
                reviewed_by = ?, reviewed_by_name = ?, review_notification_status = 'pending',
                reviewed_at = ?, review_version = review_version + 1, updated_at = ?
          WHERE id = ? AND line_account_id = ? AND status = 'pending' AND review_version = ?`,
      ).bind(
        status, awarded, reasonCode || null, reasonNote || null, reviewer.id, reviewer.name,
        now, now, c.req.param('id'), accountId, body!.expectedVersion,
      ),
      ...(status === 'adopted' && photo.customer_id ? [c.env.DB.prepare(
        `INSERT INTO nen_photo_reward_outbox
          (id, photo_id, line_account_id, friend_id, customer_id, provider_award_key,
           policy_version, points, status, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'legacy-5', ?, 'pending', ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), photo.id, accountId, photo.friend_id, photo.customer_id,
        `nen-photo:${String(photo.id)}`, awarded, now, now, now,
      )] : []),
    ]);
    if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
      return c.json({ success: false, error: 'Already reviewed' }, 409);
    }
  } catch (error) {
    if (!String(error).includes('UNIQUE constraint failed')) {
      console.error('photo review decision failed', error);
    }
    return c.json({ success: false, error: '同じ写真がほかの担当者により更新されました' }, 409);
  }
  await syncNenPhotoTags(c.env.DB, String(photo.friend_id));
  const delivery = await deliverPhotoReviewNotification(c.env.DB, c, photo, {
    lineAccountId: accountId,
    photoId: photo.id,
    status: status as 'adopted' | 'rejected',
    reasonCode: reasonCode ? reasonCode as PhotoReviewReasonCode : null,
    reasonNote: reasonNote || null,
    decisionId,
  });
  return c.json({
    success: true,
    data: {
      awardedPoints: awarded,
      pointBalance: null,
      pointSync,
      notificationStatus: delivery.notificationStatus,
    },
  });
});

nenMembers.post('/api/nen-members/photos/:id/notification/retry', requireRole('owner', 'admin', 'staff'), requirePhotoPermission('photo.submission.review'), async (c) => {
  const body = await c.req.json<{ accountId?: string }>().catch(() => null);
  const accountId = body?.accountId?.trim();
  if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
  }
  const now = new Date().toISOString();
  const row = await c.env.DB.prepare(
    `SELECT ps.id, ps.friend_id, f.line_user_id, f.line_account_id, f.is_following,
            a.channel_access_token, a.channel_access_token_encrypted,
            e.id decision_id, e.to_status, e.reason_code, e.reason_note
       FROM nen_photo_submissions ps
       JOIN friends f ON f.id = ps.friend_id
       JOIN line_accounts a ON a.id = f.line_account_id
       JOIN nen_photo_review_events e ON e.photo_id = ps.id
      WHERE ps.id = ? AND ps.line_account_id = ? AND f.line_account_id = ?
        AND (e.notification_status = 'failed'
          OR (e.notification_status = 'sending'
            AND (e.notification_lease_expires_at IS NULL OR e.notification_lease_expires_at <= ?)))
      ORDER BY e.created_at DESC LIMIT 1`,
  ).bind(c.req.param('id'), accountId, accountId, now).first<ReviewPhotoRow & {
    decision_id: string;
    to_status: 'adopted' | 'rejected';
    reason_code: PhotoReviewReasonCode | null;
    reason_note: string | null;
  }>();
  if (!row) {
    const settled = await c.env.DB.prepare(
      `SELECT e.notification_status AS notification_status
         FROM nen_photo_review_events e
        WHERE e.photo_id = ? AND e.line_account_id = ?
        ORDER BY e.created_at DESC LIMIT 1`,
    ).bind(c.req.param('id'), accountId).first<{ notification_status: string }>();
    if (settled?.notification_status === 'sent') {
      return c.json({ success: true, data: { notificationStatus: 'sent', resent: false } });
    }
    return c.json({ success: false, error: '再送する通知がありません' }, 409);
  }
  const delivery = await deliverPhotoReviewNotification(c.env.DB, c, row, {
    lineAccountId: accountId,
    photoId: row.id,
    status: row.to_status,
    reasonCode: row.reason_code,
    reasonNote: row.reason_note,
    decisionId: row.decision_id,
  });
  if (delivery.notificationStatus === 'sent') {
    return c.json({ success: true, data: { notificationStatus: 'sent', resent: delivery.relayed } });
  }
  if (delivery.busy) {
    return c.json({ success: false, error: delivery.notificationError }, 409);
  }
  return c.json({ success: false, error: delivery.notificationError }, 502);
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

nenMembers.get('/api/nen-members/friends/:friendId', requireRole('owner', 'admin', 'staff'), async (c) => {
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
    c.env.DB.prepare(
      `SELECT ps.id, ps.friend_id, ps.pet_id, ps.caption, ps.status, ps.awarded_points,
              ps.point_transaction_id, ps.created_at, ps.reviewed_at, ps.updated_at,
              ps.line_account_id, ps.publication_consent_version, ps.publication_consent_at,
              ps.publication_withdrawn_at, ps.public_pet_name, ps.review_reason_code,
              ps.review_reason_note, ps.reviewed_by, ps.reviewed_by_name,
              ps.review_notification_status, ps.review_image_url, ps.public_image_url,
              ps.image_width, ps.image_height, ps.image_byte_size, ps.captured_device,
              ps.review_version, p.name AS pet_name
         FROM nen_photo_submissions ps
         LEFT JOIN nen_pet_profiles p ON p.id = ps.pet_id
        WHERE ps.friend_id = ?
        ORDER BY ps.created_at DESC LIMIT 100`,
    ).bind(friendId).all<Record<string, unknown>>(),
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
