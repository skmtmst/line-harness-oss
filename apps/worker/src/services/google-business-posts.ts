/**
 * Google Business Profile：投稿（最新情報・イベント・特典）。第3段。
 *
 * - この層はDBを触らない。Googleの形式と、画面で扱いやすい形式の変換だけを持つ。
 * - Local Posts API（accounts.locations.localPosts）には作成用の冪等キーが無く、
 *   送信は毎回新規投稿になる。二重投稿の防止は呼び出し側（route層）が
 *   content_fingerprint で行う。この層は指紋の計算だけを提供する。
 * - EVENT/OFFER は event（title+schedule）が必須。OFFER では callToAction を送らない
 *   （Google側が無視するため、内部の値と表示のズレを作らないよう最初から付けない）。
 * - media は sourceUrl のみ対応（公開URLをGoogleが取得しに行く）。
 * - トークン・秘密値をログや例外に含めない。
 */
import { authorizedJson, type RequestOptions } from './google-business.js';
import { dateToString, fingerprintOf, isValidDate, isValidTime, stringToDate, stringToTime, timeToString } from './google-business-profile.js';

const POSTS_URL = 'https://mybusiness.googleapis.com/v4';
/** 通信は第1段と同じ再試行付きの authorizedJson を使う。 */
const authorized = authorizedJson;

export const POST_SUMMARY_MAX_LENGTH = 1500;
export const LOCAL_POSTS_LIST_MAX_PAGES = 10;

export type LocalPostKind = 'standard' | 'event' | 'offer';
export type PostCtaType = 'book' | 'order' | 'shop' | 'learn_more' | 'sign_up' | 'call';
export type GooglePostState = 'LIVE' | 'PROCESSING' | 'SCHEDULED' | 'REJECTED' | 'RECURRING' | 'UNKNOWN';

/** 画面で扱う日時。日付は"YYYY-MM-DD"、時刻は"HH:MM"。 */
export interface PostSchedule {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

export interface PostCta {
  type: PostCtaType;
  /** 'call' のときは付けない（Google公式が明記）。 */
  url: string | null;
}

export interface PostOffer {
  couponCode: string | null;
  redeemOnlineUrl: string | null;
  termsConditions: string | null;
}

/** 画面とDBで扱う投稿の中身（Googleの形は知らない）。 */
export interface PostDraft {
  kind: LocalPostKind;
  summary: string;
  /** event / offer では必須。standard では使わない。 */
  title: string | null;
  /** event / offer では必須。 */
  schedule: PostSchedule | null;
  /** offer では付けない（Google側が無視するため）。 */
  cta: PostCta | null;
  /** offer のときだけ使う。 */
  offer: PostOffer | null;
  /** 第3段は0〜1件。 */
  media: Array<{ sourceUrl: string }>;
}

/** Googleのlocalpostsから読んだ形。 */
export interface GooglePost {
  name: string;
  kind: LocalPostKind | 'alert' | 'unknown';
  summary: string;
  title: string | null;
  schedule: PostSchedule | null;
  offer: PostOffer | null;
  state: GooglePostState;
  searchUrl: string | null;
  createTime: string | null;
  updateTime: string | null;
  mediaUrls: string[];
}

// ---------- 画面 → Google ----------

interface RawGoogleDate {
  year?: number;
  month?: number;
  day?: number;
}
interface RawGoogleTime {
  hours?: number;
  minutes?: number;
}
interface RawSchedule {
  startDate?: RawGoogleDate;
  startTime?: RawGoogleTime;
  endDate?: RawGoogleDate;
  endTime?: RawGoogleTime;
}
interface RawEvent {
  title?: string;
  schedule?: RawSchedule;
}
interface RawCallToAction {
  actionType?: string;
  url?: string;
}
interface RawOffer {
  couponCode?: string;
  redeemOnlineUrl?: string;
  termsConditions?: string;
}
interface RawMediaItem {
  mediaFormat?: string;
  sourceUrl?: string;
  googleUrl?: string;
}
export interface RawLocalPost {
  name?: string;
  languageCode?: string;
  summary?: string;
  topicType?: string;
  event?: RawEvent;
  callToAction?: RawCallToAction;
  offer?: RawOffer;
  media?: RawMediaItem[];
  state?: string;
  searchUrl?: string;
  createTime?: string;
  updateTime?: string;
}

const CTA_ACTION_TYPE: Record<PostCtaType, string> = {
  book: 'BOOK',
  order: 'ORDER',
  shop: 'SHOP',
  learn_more: 'LEARN_MORE',
  sign_up: 'SIGN_UP',
  call: 'CALL',
};

const TOPIC_TYPE_OF: Record<LocalPostKind, string> = { standard: 'STANDARD', event: 'EVENT', offer: 'OFFER' };

/** 画面の投稿案 → Googleへ送るLocalPost。呼び出し側は事前に validatePostDraft を通していること。 */
export function buildLocalPost(draft: PostDraft): RawLocalPost {
  const body: RawLocalPost = {
    languageCode: 'ja',
    summary: draft.summary,
    topicType: TOPIC_TYPE_OF[draft.kind],
  };
  if ((draft.kind === 'event' || draft.kind === 'offer') && draft.title && draft.schedule) {
    body.event = {
      title: draft.title,
      schedule: {
        startDate: stringToDate(draft.schedule.startDate),
        startTime: stringToTime(draft.schedule.startTime),
        endDate: stringToDate(draft.schedule.endDate),
        endTime: stringToTime(draft.schedule.endTime),
      },
    };
  }
  // OFFERではGoogleがcallToActionを無視するため、そもそも送らない（表示との齟齬を防ぐ）。
  if (draft.kind !== 'offer' && draft.cta) {
    body.callToAction = {
      actionType: CTA_ACTION_TYPE[draft.cta.type],
      ...(draft.cta.type !== 'call' && draft.cta.url ? { url: draft.cta.url } : {}),
    };
  }
  if (draft.kind === 'offer' && draft.offer) {
    const offer: RawOffer = {};
    if (draft.offer.couponCode) offer.couponCode = draft.offer.couponCode;
    if (draft.offer.redeemOnlineUrl) offer.redeemOnlineUrl = draft.offer.redeemOnlineUrl;
    if (draft.offer.termsConditions) offer.termsConditions = draft.offer.termsConditions;
    body.offer = offer;
  }
  if (draft.media.length) {
    body.media = draft.media.map((m) => ({ mediaFormat: 'PHOTO', sourceUrl: m.sourceUrl }));
  }
  return body;
}

// ---------- Google → 画面 ----------

const KNOWN_STATES: readonly string[] = ['LIVE', 'PROCESSING', 'SCHEDULED', 'REJECTED', 'RECURRING'];
const KNOWN_KINDS: Record<string, GooglePost['kind']> = { STANDARD: 'standard', EVENT: 'event', OFFER: 'offer', ALERT: 'alert' };

function scheduleFrom(event: RawEvent | undefined): PostSchedule | null {
  const s = event?.schedule;
  const startDate = dateToString(s?.startDate);
  const endDate = dateToString(s?.endDate);
  if (!startDate || !endDate || !s?.startTime || !s.endTime) return null;
  return { startDate, startTime: timeToString(s.startTime), endDate, endTime: timeToString(s.endTime) };
}

/** Googleが返した値を画面の形に直す。未知の state/topicType は落とさず 'UNKNOWN'/'unknown' にする。 */
export function normalizePost(raw: RawLocalPost): GooglePost {
  const offer = raw.offer
    ? {
        couponCode: raw.offer.couponCode ?? null,
        redeemOnlineUrl: raw.offer.redeemOnlineUrl ?? null,
        termsConditions: raw.offer.termsConditions ?? null,
      }
    : null;
  return {
    name: raw.name ?? '',
    kind: (raw.topicType ? KNOWN_KINDS[raw.topicType] : undefined) ?? 'unknown',
    summary: raw.summary ?? '',
    title: raw.event?.title ?? null,
    schedule: scheduleFrom(raw.event),
    offer,
    state: raw.state && KNOWN_STATES.includes(raw.state) ? (raw.state as GooglePostState) : 'UNKNOWN',
    searchUrl: raw.searchUrl ?? null,
    createTime: raw.createTime ?? null,
    updateTime: raw.updateTime ?? null,
    mediaUrls: (raw.media ?? []).map((m) => m.sourceUrl ?? m.googleUrl ?? '').filter((url) => url.length > 0),
  };
}

// ---------- 検証 ----------

export type PostValidationReason =
  | 'empty_summary'
  | 'too_long'
  | 'control_chars'
  | 'title_required'
  | 'schedule_required'
  | 'schedule_invalid'
  | 'schedule_order'
  | 'schedule_past'
  | 'cta_url_invalid'
  | 'cta_call_url'
  | 'offer_cta_not_allowed'
  | 'media_too_many'
  | 'media_url_invalid';

/** 制御文字チェック（validateReplyText＝第1段と同じ判定基準）。改行・タブは許す。 */
function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c <= 8 || c === 11 || c === 12 || (c >= 14 && c <= 31) || c === 127) return true;
  }
  return false;
}

/**
 * 投稿案を検証する。today は店舗タイムゾーンの"YYYY-MM-DD"（呼び出し側が todayIn() で用意する）。
 * 第3段は「今すぐ公開」のみ扱うため schedule はEVENT/OFFERの開催期間としてのみ検証し、
 * publish_mode='scheduled'（予約投稿）はここでは弾かない（route層が 400 not_supported で断る）。
 */
export function validatePostDraft(draft: PostDraft, today: string): { ok: true; draft: PostDraft } | { ok: false; reason: PostValidationReason } {
  const summary = draft.summary.replace(/\r\n/g, '\n').trim();
  if (!summary) return { ok: false, reason: 'empty_summary' };
  if (summary.length > POST_SUMMARY_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  if (hasControlChars(summary)) return { ok: false, reason: 'control_chars' };

  if (draft.kind === 'event' || draft.kind === 'offer') {
    if (!draft.title?.trim()) return { ok: false, reason: 'title_required' };
    if (!draft.schedule) return { ok: false, reason: 'schedule_required' };
    const { startDate, startTime, endDate, endTime } = draft.schedule;
    if (!isValidDate(startDate) || !isValidDate(endDate) || !isValidTime(startTime) || !isValidTime(endTime)) {
      return { ok: false, reason: 'schedule_invalid' };
    }
    if (startDate < today) return { ok: false, reason: 'schedule_past' };
    if (`${endDate}T${endTime}` < `${startDate}T${startTime}`) return { ok: false, reason: 'schedule_order' };
  }

  if (draft.kind === 'offer') {
    if (draft.cta) return { ok: false, reason: 'offer_cta_not_allowed' };
  } else if (draft.cta) {
    if (draft.cta.type === 'call') {
      if (draft.cta.url) return { ok: false, reason: 'cta_call_url' };
    } else if (!draft.cta.url || !/^https?:\/\//.test(draft.cta.url)) {
      return { ok: false, reason: 'cta_url_invalid' };
    }
  }

  if (draft.media.length > 1) return { ok: false, reason: 'media_too_many' };
  for (const m of draft.media) {
    if (!/^https:\/\//.test(m.sourceUrl)) return { ok: false, reason: 'media_url_invalid' };
  }

  return { ok: true, draft: { ...draft, summary } };
}

// ---------- 指紋（二重投稿の検出） ----------

/** postFingerprintOf / fingerprintOfGooglePost が必ず同じキー順で組み立てる指紋の材料。 */
interface PostFingerprintInput {
  kind: string;
  summary: string;
  title: string | null;
  schedule: PostSchedule | null;
  offer: PostOffer | null;
  mediaUrls: string[];
}

function offerForFingerprint(kind: string, offer: PostOffer | null): PostOffer | null {
  if (kind !== 'offer' || !offer) return null;
  return { couponCode: offer.couponCode || null, redeemOnlineUrl: offer.redeemOnlineUrl || null, termsConditions: offer.termsConditions || null };
}

/** 送信前の下書きから指紋を作る。id・時刻など Google 側に残らない値は混ぜない。 */
export async function postFingerprintOf(draft: PostDraft): Promise<string> {
  const input: PostFingerprintInput = {
    kind: draft.kind,
    summary: draft.summary.trim(),
    title: draft.title?.trim() || null,
    schedule: draft.schedule,
    offer: offerForFingerprint(draft.kind, draft.offer),
    mediaUrls: draft.media.map((m) => m.sourceUrl),
  };
  return fingerprintOf(input);
}

/** Googleから読んだ投稿から指紋を作る。postFingerprintOf と同じ形・同じキー順にすること。 */
export async function fingerprintOfGooglePost(post: GooglePost): Promise<string> {
  const input: PostFingerprintInput = {
    kind: post.kind,
    summary: post.summary.trim(),
    title: post.title?.trim() || null,
    schedule: post.schedule,
    offer: offerForFingerprint(post.kind, post.offer),
    mediaUrls: post.mediaUrls,
  };
  return fingerprintOf(input);
}

// ---------- Google API ----------

/** 投稿を作成する（作成型・冪等キー無し）。再試行すると二重投稿になるため retry:false。 */
export async function createLocalPost(options: RequestOptions, locationName: string, draft: PostDraft): Promise<GooglePost> {
  const raw = await authorized<RawLocalPost>(options, `${POSTS_URL}/${locationName}/localPosts`, {
    method: 'POST',
    body: buildLocalPost(draft),
    retry: false,
  });
  return normalizePost(raw);
}

/** 投稿一覧を新しい順に取得する。listMedia（第2段）と同じ上限ページ数で打ち切る。 */
export async function listLocalPosts(options: RequestOptions, locationName: string): Promise<GooglePost[]> {
  const posts: GooglePost[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < LOCAL_POSTS_LIST_MAX_PAGES; page += 1) {
    const url = new URL(`${POSTS_URL}/${locationName}/localPosts`);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const body = await authorized<{ localPosts?: RawLocalPost[]; nextPageToken?: string }>(options, url.toString());
    for (const raw of body.localPosts ?? []) posts.push(normalizePost(raw));
    pageToken = body.nextPageToken ?? null;
    if (!pageToken) break;
  }
  return posts;
}

export async function deleteLocalPost(options: RequestOptions, postName: string): Promise<void> {
  await authorized<unknown>(options, `${POSTS_URL}/${postName}`, { method: 'DELETE' });
}
