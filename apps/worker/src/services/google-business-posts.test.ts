import { describe, expect, it } from 'vitest';
import {
  buildLocalPost,
  createLocalPost,
  fingerprintOfGooglePost,
  normalizePost,
  postFingerprintOf,
  validatePostDraft,
  type PostDraft,
  type RawLocalPost,
} from './google-business-posts.js';
import type { FetchLike } from './google-business.js';

const LOCATION = 'accounts/111/locations/222';
const TODAY = '2026-09-28';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fetchFrom(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): { fetch: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch, calls };
}

const noSleep = async () => {};

const standardDraft: PostDraft = {
  kind: 'standard',
  summary: '秋のおすすめ定食がはじまります。',
  title: null,
  schedule: null,
  cta: { type: 'book', url: 'https://example.com/reservation' },
  offer: null,
  media: [{ sourceUrl: 'https://worker.example/images/abc.jpg' }],
};

const eventDraft: PostDraft = {
  kind: 'event',
  summary: '旬の食材を楽しむ、1日限定のディナーイベントです。',
  title: '秋の食材を楽しむ夕べ',
  schedule: { startDate: '2026-10-03', startTime: '18:00', endDate: '2026-10-03', endTime: '21:00' },
  cta: { type: 'book', url: 'https://example.com/event' },
  offer: null,
  media: [],
};

const offerDraft: PostDraft = {
  kind: 'offer',
  summary: '週末のディナーで使える、お会計10%OFFの特典です。',
  title: '週末のディナーを、少しお得に',
  schedule: { startDate: '2026-09-26', startTime: '17:00', endDate: '2026-09-27', endTime: '22:00' },
  cta: null,
  offer: { couponCode: 'AUTUMN10', redeemOnlineUrl: 'https://example.com/offer', termsConditions: 'ディナータイム限定。' },
  media: [],
};

describe('buildLocalPost', () => {
  it('standard は topicType=STANDARD、event を付けない', () => {
    const body = buildLocalPost(standardDraft);
    expect(body.topicType).toBe('STANDARD');
    expect(body.languageCode).toBe('ja');
    expect(body.event).toBeUndefined();
    expect(body.callToAction).toEqual({ actionType: 'BOOK', url: 'https://example.com/reservation' });
    expect(body.media).toEqual([{ mediaFormat: 'PHOTO', sourceUrl: 'https://worker.example/images/abc.jpg' }]);
  });

  it('event は event.title と schedule の4項目を必ず入れる', () => {
    const body = buildLocalPost(eventDraft);
    expect(body.topicType).toBe('EVENT');
    expect(body.event).toEqual({
      title: '秋の食材を楽しむ夕べ',
      schedule: {
        startDate: { year: 2026, month: 10, day: 3 },
        startTime: { hours: 18, minutes: 0 },
        endDate: { year: 2026, month: 10, day: 3 },
        endTime: { hours: 21, minutes: 0 },
      },
    });
    expect(body.callToAction).toEqual({ actionType: 'BOOK', url: 'https://example.com/event' });
  });

  it('offer は event を入れるが callToAction は入れない（Googleが無視するため）', () => {
    const body = buildLocalPost(offerDraft);
    expect(body.topicType).toBe('OFFER');
    expect(body.event?.title).toBe('週末のディナーを、少しお得に');
    expect(body.callToAction).toBeUndefined();
    expect(body.offer).toEqual({
      couponCode: 'AUTUMN10',
      redeemOnlineUrl: 'https://example.com/offer',
      termsConditions: 'ディナータイム限定。',
    });
  });

  it('call は url を付けない', () => {
    const body = buildLocalPost({ ...standardDraft, cta: { type: 'call', url: null } });
    expect(body.callToAction).toEqual({ actionType: 'CALL' });
  });
});

describe('validatePostDraft', () => {
  it('空本文は拒否する', () => {
    expect(validatePostDraft({ ...standardDraft, summary: '  ' }, TODAY)).toEqual({ ok: false, reason: 'empty_summary' });
  });

  it('1501文字は拒否する', () => {
    expect(validatePostDraft({ ...standardDraft, summary: 'あ'.repeat(1501) }, TODAY)).toEqual({ ok: false, reason: 'too_long' });
  });

  it('制御文字は拒否する', () => {
    const withControlChar = '本文' + String.fromCharCode(1) + 'です';
    expect(validatePostDraft({ ...standardDraft, summary: withControlChar }, TODAY)).toEqual({ ok: false, reason: 'control_chars' });
  });

  it('event でタイトルが無ければ拒否する', () => {
    expect(validatePostDraft({ ...eventDraft, title: null }, TODAY)).toEqual({ ok: false, reason: 'title_required' });
  });

  it('event で終了が開始より前なら拒否する', () => {
    const draft = { ...eventDraft, schedule: { startDate: '2026-10-03', startTime: '21:00', endDate: '2026-10-03', endTime: '18:00' } };
    expect(validatePostDraft(draft, TODAY)).toEqual({ ok: false, reason: 'schedule_order' });
  });

  it('過去の開始日は拒否する', () => {
    const draft = { ...eventDraft, schedule: { ...eventDraft.schedule!, startDate: '2020-01-01', endDate: '2020-01-01' } };
    expect(validatePostDraft(draft, TODAY)).toEqual({ ok: false, reason: 'schedule_past' });
  });

  it('offer に CTA が付いていたら拒否する', () => {
    const draft = {
      ...offerDraft,
      schedule: { startDate: '2026-10-01', startTime: '17:00', endDate: '2026-10-02', endTime: '22:00' },
      cta: { type: 'book' as const, url: 'https://example.com' },
    };
    expect(validatePostDraft(draft, TODAY)).toEqual({ ok: false, reason: 'offer_cta_not_allowed' });
  });

  it('call の CTA に url が付いていたら拒否する', () => {
    expect(validatePostDraft({ ...standardDraft, cta: { type: 'call', url: 'https://example.com' } }, TODAY)).toEqual({ ok: false, reason: 'cta_call_url' });
  });

  it('画像は2件以上を拒否する', () => {
    const draft = { ...standardDraft, media: [{ sourceUrl: 'https://a.example/1.jpg' }, { sourceUrl: 'https://a.example/2.jpg' }] };
    expect(validatePostDraft(draft, TODAY)).toEqual({ ok: false, reason: 'media_too_many' });
  });

  it('http以外の画像URLを拒否する', () => {
    const draft = { ...standardDraft, media: [{ sourceUrl: 'ftp://a.example/1.jpg' }] };
    expect(validatePostDraft(draft, TODAY)).toEqual({ ok: false, reason: 'media_url_invalid' });
  });

  it('妥当な下書きは通す', () => {
    expect(validatePostDraft(eventDraft, TODAY)).toMatchObject({ ok: true });
  });
});

describe('normalizePost', () => {
  it('未知の topicType/state は unknown/UNKNOWN に落ちる', () => {
    const post = normalizePost({ name: 'p1', summary: 's', topicType: 'FUTURE_TYPE', state: 'FUTURE_STATE' } as RawLocalPost);
    expect(post.kind).toBe('unknown');
    expect(post.state).toBe('UNKNOWN');
  });

  it('REJECTED をそのまま読める', () => {
    const post = normalizePost({ name: 'p1', summary: 's', topicType: 'STANDARD', state: 'REJECTED' });
    expect(post.state).toBe('REJECTED');
  });
});

describe('指紋の往復', () => {
  it('送信前の下書きと、送信後にGoogleから読み戻した投稿の指紋が一致する（二重投稿防止の土台）', async () => {
    for (const draft of [standardDraft, eventDraft, offerDraft]) {
      const sentBody = buildLocalPost(draft);
      const roundTripped = normalizePost({ ...sentBody, name: 'accounts/1/locations/2/localPosts/9', state: 'LIVE' });
      const before = await postFingerprintOf(draft);
      const after = await fingerprintOfGooglePost(roundTripped);
      expect(after).toBe(before);
    }
  });

  it('本文が変われば指紋も変わる（誤って同一視しない）', async () => {
    const a = await postFingerprintOf(standardDraft);
    const b = await postFingerprintOf({ ...standardDraft, summary: standardDraft.summary + '追記' });
    expect(a).not.toBe(b);
  });
});

describe('createLocalPost', () => {
  it('429でも再試行しない（retry:false。再試行すると二重投稿になるため）', async () => {
    const { fetch, calls } = fetchFrom(() => jsonResponse({}, 429));
    await expect(createLocalPost({ fetch, accessToken: 'at', sleep: noSleep }, LOCATION, standardDraft)).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(calls).toHaveLength(1);
  });

  it('成功時はPOST本文がbuildLocalPostの形と一致する', async () => {
    const { fetch, calls } = fetchFrom(() => jsonResponse({ name: 'accounts/1/locations/2/localPosts/9', summary: standardDraft.summary, topicType: 'STANDARD', state: 'LIVE' }));
    const post = await createLocalPost({ fetch, accessToken: 'at', sleep: noSleep }, LOCATION, standardDraft);
    expect(calls[0].url).toBe(`https://mybusiness.googleapis.com/v4/${LOCATION}/localPosts`);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(buildLocalPost(standardDraft));
    expect(post.state).toBe('LIVE');
    expect(post.name).toBe('accounts/1/locations/2/localPosts/9');
  });
});
