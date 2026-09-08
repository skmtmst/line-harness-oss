import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { buildXOAuth1Header, drainAdConversionOutbox, googleConversionDateTime, sendAdConversions } from './ad-conversion.js';

const sentRequests: Array<{ url: string; body: unknown }> = [];

function mockFetchOk(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    sentRequests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return { ok: true, text: async () => 'ok' };
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  sentRequests.length = 0;
});

function seedAccount(testDb: SqliteD1, id: string): void {
  testDb.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run(id, `channel-${id}`, id);
}

function seedPlatform(
  testDb: SqliteD1,
  id: string,
  lineAccountId: string | null,
  opts: { active?: boolean } = {},
): void {
  testDb.raw.prepare(
    `INSERT INTO ad_platforms (id, name, display_name, config, is_active, line_account_id, created_at, updated_at)
     VALUES (?, 'meta', 'Meta広告', '{"pixel_id":"PIXEL-1","access_token":"token-1234567890"}', ?, ?, '2026-09-08T00:00:00+09:00', '2026-09-08T00:00:00+09:00')`,
  ).run(id, opts.active === false ? 0 : 1, lineAccountId);
}

function seedRef(testDb: SqliteD1, id: string, friendId: string): void {
  testDb.raw.prepare(
    `INSERT INTO ref_tracking (id, ref_code, friend_id, fbclid, created_at)
     VALUES (?, 'ref-1', ?, 'fb-click-1', '2026-09-08T00:00:00+09:00')`,
  ).run(id, friendId);
}

function seedTwoAccounts(): SqliteD1 {
  const testDb = createTestD1();
  seedAccount(testDb, 'a1');
  seedAccount(testDb, 'a2');
  insertFriend(testDb.raw, 'f1', { line_account_id: 'a1' });
  insertFriend(testDb.raw, 'f2', { line_account_id: 'a2' });
  seedRef(testDb, 'ref-1', 'f1');
  seedRef(testDb, 'ref-2', 'f2');
  seedPlatform(testDb, 'p1', 'a1');
  seedPlatform(testDb, 'p2', 'a2');
  // 359以前の帰属不明行を再現する(トリガ導入後は新規作成できない)。
  testDb.raw.exec('DROP TRIGGER trg_ad_platforms_account_required_insert');
  seedPlatform(testDb, 'p-legacy', null);
  return testDb;
}

function logs(testDb: SqliteD1): Array<{ ad_platform_id: string; friend_id: string; line_account_id: string | null; status: string }> {
  return testDb.raw.prepare(
    `SELECT ad_platform_id, friend_id, line_account_id, status FROM ad_conversion_logs ORDER BY ad_platform_id`,
  ).all() as Array<{ ad_platform_id: string; friend_id: string; line_account_id: string | null; status: string }>;
}

describe('sendAdConversions のアカウント境界(#638)', () => {
  it('友だち所属アカウントの設定だけ外部送信・記録し、他店と帰属不明には送らない', async () => {
    const testDb = seedTwoAccounts();
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000);

    expect(sentRequests).toHaveLength(1);
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'sent' },
    ]);
  });

  it('もう一方のアカウントの友だちは自アカウントの設定だけ使う', async () => {
    const testDb = seedTwoAccounts();
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f2', 'Purchase');

    expect(sentRequests).toHaveLength(1);
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p2', friend_id: 'f2', line_account_id: 'a2', status: 'sent' },
    ]);
  });

  it('広告クリックIDが無い友だちは何も送らない', async () => {
    const testDb = seedTwoAccounts();
    insertFriend(testDb.raw, 'f3', { line_account_id: 'a1' });
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f3', 'Purchase');

    expect(sentRequests).toHaveLength(0);
    expect(logs(testDb)).toHaveLength(0);
  });

  it('所属不明・存在しない友だちは送らず投げない', async () => {
    const testDb = seedTwoAccounts();
    insertFriend(testDb.raw, 'f9', { line_account_id: null });
    seedRef(testDb, 'ref-9', 'f9');
    mockFetchOk();

    await expect(sendAdConversions(testDb.db, 'f9', 'Purchase')).resolves.toBeUndefined();
    await expect(sendAdConversions(testDb.db, 'no-such-friend', 'Purchase')).resolves.toBeUndefined();
    expect(sentRequests).toHaveLength(0);
    expect(logs(testDb)).toHaveLength(0);
  });

  it('同じ冪等キーの再試行は送らない。キーが違えば送る', async () => {
    const testDb = seedTwoAccounts();
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-1' });
    // 再試行で金額が違って届いても、同じ出来事として送らない。
    await sendAdConversions(testDb.db, 'f1', 'Purchase', 2000, { idempotencyKey: 'stripe:evt-1' });
    expect(sentRequests).toHaveLength(1);
    expect(logs(testDb)).toHaveLength(1);

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-2' });
    expect(sentRequests).toHaveLength(2);
    expect(logs(testDb)).toHaveLength(2);
  });

  it('同じキーの同時実行は1件だけ送る', async () => {
    const testDb = seedTwoAccounts();
    mockFetchOk();

    await Promise.all([
      sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-9' }),
      sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-9' }),
    ]);

    expect(sentRequests).toHaveLength(1);
    expect(logs(testDb)).toHaveLength(1);
  });

  it('失敗済みの同じキーは取り直して送り直せる', async () => {
    const testDb = seedTwoAccounts();
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> => {
      sentRequests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (fail) return { ok: false, status: 500, text: async () => 'error' };
      return { ok: true, status: 200, text: async () => 'ok' };
    }));

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-3' });
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'failed' },
    ]);

    fail = false;
    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-3' });
    expect(sentRequests).toHaveLength(2);
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'sent' },
    ]);
  });

  it('同じ鍵で内容が変われば拒否し、最初の記録を残す', async () => {
    const testDb = seedTwoAccounts();
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-5' });
    await sendAdConversions(testDb.db, 'f1', 'Purchase', 2000, { idempotencyKey: 'stripe:evt-5' });

    expect(sentRequests).toHaveLength(1);
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'sent' },
    ]);
  });

  it('友だち移動後の再送は初回の所属で送り、新所属へ誤送信しない', async () => {
    const testDb = seedTwoAccounts();
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-6', lineAccountId: 'a1' });
    expect(sentRequests).toHaveLength(1);

    // 友だちが a2 へ移動した後に同じ出来事を再送しても、新所属(a2)では送らない。
    testDb.raw.prepare(`UPDATE friends SET line_account_id = 'a2' WHERE id = 'f1'`).run();
    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-6' });

    expect(sentRequests).toHaveLength(1);
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'sent' },
    ]);
  });

  it('媒体側の重複排除IDは鍵から決まり、再送でも同じになる', async () => {
    const testDb = seedTwoAccounts();
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-7' });

    expect(sentRequests).toHaveLength(1);
    const metaBody = sentRequests[0].body as { data: Array<{ event_id: string; event_name: string }> };
    expect(metaBody.data[0]).toMatchObject({ event_id: 'stripe:evt-7:p1', event_name: 'Purchase' });
  });

  it('Xの署名はRFC 5849方式の独立計算と一致する', async () => {
    const { createHmac } = await import('node:crypto');
    // RFC 5849 §3.4.1 の手順をテスト側で素朴に再現した期待値。実装とは別経路。
    const baseString = 'GET&http%3A%2F%2Fphotos.example.net%2Fphotos'
      + '&oauth_consumer_key%3Ddpf43f3p2l4k3l03'
      + '%26oauth_nonce%3Dkllo9940pd9333jh'
      + '%26oauth_signature_method%3DHMAC-SHA1'
      + '%26oauth_timestamp%3D1191242096'
      + '%26oauth_token%3Dnnch734d00sl2jdk'
      + '%26oauth_version%3D1.0';
    const expected = createHmac('sha1', 'kd94hf93k423kf44&pfkkdhi9sl3r4s00').update(baseString).digest('base64');

    const header = await buildXOAuth1Header('GET', 'http://photos.example.net/photos', {
      consumerKey: 'dpf43f3p2l4k3l03',
      consumerSecret: 'kd94hf93k423kf44',
      token: 'nnch734d00sl2jdk',
      tokenSecret: 'pfkkdhi9sl3r4s00',
    }, { nonce: 'kllo9940pd9333jh', timestamp: '1191242096' });

    expect(header).toContain(`oauth_signature="${encodeURIComponent(expected)}"`);
    expect(header).toContain('oauth_consumer_key="dpf43f3p2l4k3l03"');
    expect(header.startsWith('OAuth ')).toBe(true);
  });

  it('Xは資格情報がそろわなければ送らず失敗で残す', async () => {
    const testDb = seedTwoAccounts();
    testDb.raw.prepare(`UPDATE ad_platforms SET name = 'x', line_account_id = 'a1' WHERE id = 'p1'`).run();
    testDb.raw.prepare(`INSERT INTO ref_tracking (id, ref_code, friend_id, twclid, created_at)
                        VALUES ('ref-x', 'ref-1', 'f1', 'tw-1', '2026-09-09T00:00:00+09:00')`).run();
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'x:evt-1' });

    expect(sentRequests).toHaveLength(0);
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'failed' },
    ]);
  });

  it('古い確保への並行再送は1件だけ送る', async () => {
    const testDb = seedTwoAccounts();
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-8' });
    // 確保したまま落ちた状態を再現する。
    testDb.raw.prepare(`UPDATE ad_conversion_logs SET status = 'pending', created_at = '2000-01-01T00:00:00.000+09:00'`).run();

    await Promise.all([
      sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-8' }),
      sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'stripe:evt-8' }),
    ]);

    // 初回1件 + 取直し1件だけ送る。
    expect(sentRequests).toHaveLength(2);
    expect(logs(testDb)).toHaveLength(1);
  });

  it('Googleの部分失敗は失敗で残し、安定注文IDを付ける', async () => {
    const testDb = seedTwoAccounts();
    testDb.raw.prepare(`UPDATE ad_platforms SET name = 'google', line_account_id = 'a1' WHERE id = 'p1'`).run();
    testDb.raw.prepare(`INSERT INTO ref_tracking (id, ref_code, friend_id, gclid, created_at)
                        VALUES ('ref-g', 'ref-1', 'f1', 'g-1', '2026-09-09T00:00:00+09:00')`).run();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      sentRequests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return {
        ok: true,
        status: 200,
        json: async () => ({ partialFailureError: { message: 'bad conversion' } }),
        text: async () => 'partial',
      };
    }));

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'g:evt-1' });

    expect(sentRequests).toHaveLength(1);
    // v17は廃止済みのため現行版で送る。
    expect(sentRequests[0].url).toContain('googleads.googleapis.com/v25/');
    const googleBody = sentRequests[0].body as { conversions: Array<{ order_id: string; gclid: string; conversion_date_time: string }> };
    expect(googleBody.conversions[0]).toMatchObject({ order_id: 'g:evt-1:p1', gclid: 'g-1' });
    // UTC時刻に+09:00を付け替えた偽の日本時間にしない。壁時計+時差の形式。
    expect(googleBody.conversions[0].conversion_date_time).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\+09:00$/,
    );
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'failed' },
    ]);
  });

  it('Googleの発生時刻は日本時間の壁時計で送る', async () => {
    expect(googleConversionDateTime(new Date('2026-09-08T00:00:00Z'))).toBe('2026-09-08 09:00:00+09:00');
    expect(googleConversionDateTime(new Date('2026-09-08T15:30:45Z'))).toBe('2026-09-09 00:30:45+09:00');
  });

  it('補助単位の金額は通貨の桁数で主単位へ直して送る', async () => {
    const testDb = seedTwoAccounts();
    testDb.raw.prepare(`UPDATE ad_platforms SET name = 'google', line_account_id = 'a1',
                        config = '{"customer_id":"123","conversion_action_id":"456","oauth_token":"t","developer_token":"d"}'
                        WHERE id = 'p1'`).run();
    testDb.raw.prepare(`INSERT INTO ref_tracking (id, ref_code, friend_id, gclid, created_at)
                        VALUES ('ref-g2', 'ref-1', 'f1', 'g-2', '2026-09-09T00:00:00+09:00')`).run();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      sentRequests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 200, json: async () => ({}), text: async () => 'ok' };
    }));

    // 1000セント=10ドル。補助単位のまま送ると100倍の誤計上になる。
    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, {
      idempotencyKey: 'g:evt-2', currency: 'USD', amountInMinorUnit: true,
    });

    expect(sentRequests).toHaveLength(1);
    const googleBody = sentRequests[0].body as { conversions: Array<{ conversion_value: number; currency_code: string }> };
    expect(googleBody.conversions[0]).toMatchObject({ conversion_value: 10, currency_code: 'USD' });
  });

  it('通貨違いは同じ鍵でも内容不一致として送らない', async () => {
    const testDb = seedTwoAccounts();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      sentRequests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return { ok: false, status: 400, text: async () => 'bad' };
    }));

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'm:evt-1', currency: 'JPY' });
    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'm:evt-1', currency: 'USD' });

    // 指紋に通貨を含むため不一致になり、失敗分の取り直し送信ではなく要確認で止まる。
    expect(sentRequests).toHaveLength(1);
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'needs-review' },
    ]);
  });

  it('Xはpixel入りパス・出来事IDと重複排除鍵の正しい対応で送る', async () => {
    const testDb = seedTwoAccounts();
    testDb.raw.prepare(`UPDATE ad_platforms SET name = 'x', line_account_id = 'a1',
                        config = '{"pixel_id":"oka17","api_key":"k","api_secret":"s","x_oauth_token":"t","x_oauth_token_secret":"ts","conversion_id":"23294827"}'
                        WHERE id = 'p1'`).run();
    testDb.raw.prepare(`INSERT INTO ref_tracking (id, ref_code, friend_id, twclid, created_at)
                        VALUES ('ref-x2', 'ref-1', 'f1', 'tw-1', '2026-09-09T00:00:00+09:00')`).run();
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'x:evt-2' });

    expect(sentRequests).toHaveLength(1);
    expect(sentRequests[0].url).toBe('https://ads-api.x.com/12/measurement/conversions/oka17');
    const xBody = sentRequests[0].body as { conversions: Array<Record<string, unknown>> };
    // event_id=管理画面で作った出来事のID、conversion_id=今回の重複排除鍵。
    // 逆にすると帰属と重複排除の両方が壊れる。
    expect(xBody.conversions[0]).toMatchObject({
      event_id: '23294827',
      conversion_id: 'x:evt-2:p1',
      value: '1000.00',
      number_items: 1,
    });
    expect(xBody.conversions[0]).not.toHaveProperty('event_name');
    // Xのサーバー側Conversion APIのevent項目に通貨は無い。公式手順書の例は
    // value(小数文字列)/number_itemsのみで、通貨相当はWebピクセル側の
    // price_currencyに分離されている。余計な項目を送らないよう鍵集合を固定する。
    // (docs.x.com/x-ads-api/measurement/web-conversions.md の例と
    //  stape-io/twitter-tag の対応表で確認。2026-09-09)
    expect(Object.keys(xBody.conversions[0]).sort()).toEqual(
      ['conversion_id', 'conversion_time', 'event_id', 'identifiers', 'number_items', 'value'],
    );
    expect(xBody.conversions[0]).not.toHaveProperty('currency');
  });

  it('Xは出来事IDの設定がなければ送らず失敗で残す', async () => {
    const testDb = seedTwoAccounts();
    testDb.raw.prepare(`UPDATE ad_platforms SET name = 'x', line_account_id = 'a1',
                        config = '{"pixel_id":"oka17","api_key":"k","api_secret":"s","x_oauth_token":"t","x_oauth_token_secret":"ts"}'
                        WHERE id = 'p1'`).run();
    testDb.raw.prepare(`INSERT INTO ref_tracking (id, ref_code, friend_id, twclid, created_at)
                        VALUES ('ref-x3', 'ref-1', 'f1', 'tw-1', '2026-09-09T00:00:00+09:00')`).run();
    mockFetchOk();

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'x:evt-3' });

    expect(sentRequests).toHaveLength(0);
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'failed' },
    ]);
  });

  it('待ち行列に残し、失敗分は取り出しで送り直す。安定IDは変わらない', async () => {
    const testDb = seedTwoAccounts();
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      sentRequests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (fail) return { ok: false, status: 500, text: async (): Promise<string> => 'down' };
      return { ok: true, text: async (): Promise<string> => 'ok' };
    }));
    const outboxStatus = () => testDb.raw.prepare(
      `SELECT status, attempt_count FROM ad_conversion_outbox WHERE idempotency_key = 'o:evt-1'`,
    ).get() as { status: string; attempt_count: number };

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, { idempotencyKey: 'o:evt-1' });

    expect(sentRequests).toHaveLength(1);
    expect(outboxStatus()).toMatchObject({ status: 'failed', attempt_count: 1 });
    // 待ち時間の間は取り出さない。
    expect(await drainAdConversionOutbox(testDb.db)).toMatchObject({ claimed: 0, sent: 0, failed: 0 });
    expect(sentRequests).toHaveLength(1);

    // 送り時が来たら送り直す。媒体側の重複排除IDは初回のまま。
    fail = false;
    testDb.raw.prepare(`UPDATE ad_conversion_outbox SET next_attempt_at = '2000-01-01T00:00:00.000+09:00'`).run();
    expect(await drainAdConversionOutbox(testDb.db)).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(sentRequests).toHaveLength(2);
    expect(outboxStatus()).toMatchObject({ status: 'sent' });
    const bodies = sentRequests.map((r) => r.body as { data: Array<{ event_id: string }> });
    expect(bodies[0]?.data[0]?.event_id).toBe('o:evt-1:p1');
    expect(bodies[1]?.data[0]?.event_id).toBe('o:evt-1:p1');
  });

  it('送信失敗は failed で記録し投げない。1回の呼び出しで1媒体へ1回だけ送る', async () => {
    const testDb = seedTwoAccounts();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      sentRequests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return { ok: false, status: 400, text: async () => 'bad' };
    }));

    await expect(sendAdConversions(testDb.db, 'f1', 'Purchase')).resolves.toBeUndefined();

    expect(sentRequests).toHaveLength(1);
    expect(logs(testDb)).toEqual([
      { ad_platform_id: 'p1', friend_id: 'f1', line_account_id: 'a1', status: 'failed' },
    ]);
  });
});
