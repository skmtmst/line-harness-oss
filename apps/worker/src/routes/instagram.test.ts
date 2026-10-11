import { Hono } from 'hono';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { instagram } from './instagram.js';
import {
  verifyInstagramSignature,
  purgeInstagramTransientData,
  instagramConfig,
  instagramUrlDetail,
  instagramUrlScopes,
} from '../services/instagram.js';
let db: SqliteD1;
const admin: AuthenticatedStaff = {
  id: 'staff',
  name: '管理者',
  role: 'admin',
  readOnly: false,
  tenantId: 't1',
  permissionKeys: [],
};
const config = {
  META_APP_ID: '100',
  META_APP_SECRET: 'secret_mock',
  META_REDIRECT_URI: 'https://worker.test/api/instagram/oauth/callback',
  META_GRAPH_API_VERSION: 'v24.0',
  META_TOKEN_ENCRYPTION_KEY: btoa('x'.repeat(32)),
  META_WEBHOOK_VERIFY_TOKEN: 'verify_mock',
};
function app(staff = admin, configured = true) {
  const a = new Hono<Env>();
  a.use('*', async (c, next) => {
    c.env = { DB: db.db, ...(configured ? config : {}) } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  a.route('/', instagram);
  return a;
}
function req(
  path: string,
  body?: unknown,
  method = 'POST',
  staff = admin,
  configured = true,
) {
  return app(staff, configured).request(
    path + (path.includes('?') ? '&' : '?') + 'lineAccountId=a1',
    {
      method: body === undefined ? 'GET' : method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}
type Payload = {
  data: {
    url: string;
    state: string;
    pages: Array<{ pageId: string }>;
    connection: { version: number };
    version: number;
    connected: boolean;
    value: unknown;
    messages: unknown[];
    total: number;
  };
};
const read = async (r: Response) => (await r.json()) as Payload;
beforeEach(() => {
  db = createTestD1();
  db.raw.exec(
    "INSERT INTO tenants(id,name) VALUES('t1','1'),('t2','2'); INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a1','1','1','','','t1'),('a2','2','2','','','t2');",
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string) => {
      const u = new URL(String(url)),
        path = u.pathname;
      const result = path.endsWith('/debug_token')
        ? {
            data: {
              is_valid: true,
              app_id: '100',
              expires_at: Math.floor(Date.now() / 1000) + 60 * 86400,
              scopes: [
                'pages_show_list',
                'instagram_basic',
                'instagram_content_publish',
              ],
            },
          }
        : path.endsWith('/oauth/access_token')
          ? {
              access_token: u.searchParams.has('code')
                ? 'short_mock'
                : 'long_mock',
              expires_in: 60 * 86400,
            }
          : path.endsWith('/me/accounts')
            ? {
                data: [
                  {
                    id: '10',
                    name: 'ページ',
                    access_token: 'page_mock',
                    instagram_business_account: { id: '20' },
                  },
                ],
              }
            : path.endsWith('/subscribed_apps')
              ? { success: true }
              : path.endsWith('/media')
                ? { data: [{ id: 'post1', caption: '新着' }] }
                : { id: '20', username: 'test_ig' };
      return Response.json(result);
    }),
  );
});
afterEach(() => {
  db.raw.close();
  vi.unstubAllGlobals();
});
/**
 * 接続は一段。Instagram にログインして戻ってきた折り返しだけで保存が終わり、
 * ページを選ばせる画面は出さずに設定 › SNS連携へ帰る（2026-10-07 利用者承認）。
 */
async function connect() {
  const start = await read(await req('/api/instagram/oauth/start', {}));
  const url = new URL(start.data.url);
  expect(url.searchParams.get('scope')).toContain('instagram_content_publish');
  const state = url.searchParams.get('state')!;
  const callback = await req(
    '/api/instagram/oauth/callback?' +
      new URLSearchParams({ state, code: 'mock_code' }),
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get('location')).toContain(
    '/settings/sns?instagram=connected',
  );
  return state;
}
it('設定なしは未設定。Metaへ接続せず画面の読取を返す', async () => {
  expect(
    (
      await read(
        await req('/api/instagram/connection', undefined, 'GET', admin, false),
      )
    ).data.state,
  ).toBe('unconfigured');
  expect(
    (await req('/api/instagram/oauth/start', {}, 'POST', admin, false)).status,
  ).toBe(503);
  expect(fetch).not.toHaveBeenCalled();
});
it('OAuth→ページ選択→暗号化保存→更新→新着同期→切断をモックで通す', async () => {
  await connect();
  const row = db.raw
    .prepare(
      'SELECT page_token_encrypted,user_token_encrypted FROM instagram_connections',
    )
    .get() as Record<string, string>;
  expect(row.page_token_encrypted).toMatch(/^v1\./);
  expect(JSON.stringify(row)).not.toContain('page_mock');
  const status = await read(await req('/api/instagram/connection'));
  expect(status.data.connection.version).toBe(1);
  expect(JSON.stringify(status)).not.toContain('token');
  expect((await req('/api/instagram/refresh', {})).status).toBe(200);
  expect((await req('/api/instagram/sync', {})).status).toBe(200);
  expect((await read(await req('/api/instagram/posts'))).data.value).toEqual([
    { id: 'post1', caption: '新着' },
  ]);
  expect(
    (await req('/api/instagram/connection', { expectedVersion: 1 }, 'DELETE'))
      .status,
  ).toBe(409);
  expect(
    (await req('/api/instagram/connection', { expectedVersion: 2 }, 'DELETE'))
      .status,
  ).toBe(200);
  expect(
    db.raw.prepare('SELECT COUNT(*) n FROM instagram_connections').get(),
  ).toEqual({ n: 0 });
});
it('閲覧のみ・別アカウント・偽state・再利用・期限切れを拒否する', async () => {
  expect(
    (
      await req('/api/instagram/oauth/start', {}, 'POST', {
        ...admin,
        readOnly: true,
      })
    ).status,
  ).toBe(403);
  expect(
    (await app().request('/api/instagram/connection?lineAccountId=a2')).status,
  ).toBe(404);
  // 折り返しは画面へ戻す口なので、失敗の中身は出さずに instagram=failed だけを伝える。
  const wrong = await req('/api/instagram/oauth/callback?state=wrong&code=mock');
  expect(wrong.status).toBe(302);
  expect(wrong.headers.get('location')).toContain(
    '/settings/sns?instagram=failed',
  );
  const state = await connect();
  const reused = await req(
    '/api/instagram/oauth/callback?' +
      new URLSearchParams({ state, code: 'mock' }),
  );
  expect(reused.status).toBe(302);
  expect(reused.headers.get('location')).toContain(
    '/settings/sns?instagram=failed',
  );
  db.raw.exec("UPDATE instagram_connections SET expires_at='2000-01-01'");
  expect((await read(await req('/api/instagram/connection'))).data.state).toBe(
    'expired',
  );
  expect((await req('/api/instagram/sync', {})).status).toBe(409);
});
it('同時投稿の許可が無い古い接続は認可切れにして取り直させる', async () => {
  await connect();
  db.raw.exec(
    "UPDATE instagram_connections SET scopes='pages_show_list,instagram_basic'",
  );
  expect((await read(await req('/api/instagram/connection'))).data.state).toBe(
    'expired',
  );
  // 期限内でも投稿できないので、更新ではなく接続のやり直しへ回す。
  expect((await req('/api/instagram/refresh', {})).status).toBe(409);
});
it('ビジネスアカウントのつながったページが無ければ保存せず失敗を返す', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      // つながっていない普通のページだけを返す＝投稿の口が無い状態。
      if (new URL(String(url)).pathname.endsWith('/me/accounts'))
        return Response.json({
          data: [{ id: '10', name: 'ページ', access_token: 'page_mock' }],
        });
      return original(url, init);
    }),
  );
  const start = await read(await req('/api/instagram/oauth/start', {}));
  const state = new URL(start.data.url).searchParams.get('state')!;
  const callback = await req(
    '/api/instagram/oauth/callback?' +
      new URLSearchParams({ state, code: 'mock_code' }),
  );
  expect(callback.status).toBe(302);
  const back = new URL(callback.headers.get('location')!);
  // 画面が見る値は従来どおり failed だけ（帯の文言は変わらない）。
  expect(back.pathname).toBe('/settings/sns');
  expect(back.searchParams.get('instagram')).toBe('failed');
  // サーバー記録が読めない場合でも原因が分かるよう、戻り先URLに手がかりを添える。
  expect(back.searchParams.get('instagram_code')).toBe(
    'instagram_business_account_required',
  );
  expect(back.searchParams.get('instagram_pages')).toBe('1/0/1');
  expect(back.searchParams.get('instagram_scopes')).toContain(
    'instagram_content_publish',
  );
  expect(
    db.raw.prepare('SELECT COUNT(*) n FROM instagram_connections').get(),
  ).toEqual({ n: 0 });
  // 使い切りの state は捨てて、もう一度ログインからやり直せるようにする。
  expect(
    db.raw.prepare('SELECT COUNT(*) n FROM instagram_oauth_states').get(),
  ).toEqual({ n: 0 });
});
async function signed(raw: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(config.META_APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const h = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(raw),
  );
  return (
    'sha256=' +
    Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, '0')).join(
      '',
    )
  );
}
it('Webhookの確認・署名・宛先・重複を検査し、審査前の返信は送らない', async () => {
  await connect();
  const publicApp = app({ ...admin, role: 'staff', permissionKeys: [] });
  expect(
    (
      await publicApp.request(
        '/api/instagram/webhook?' +
          new URLSearchParams({
            'hub.mode': 'subscribe',
            'hub.verify_token': 'verify_mock',
            'hub.challenge': 'challenge',
          }),
      )
    ).status,
  ).toBe(200);
  const raw = JSON.stringify({
    object: 'instagram',
    entry: [
      {
        id: '20',
        messaging: [
          {
            sender: { id: '30' },
            recipient: { id: '20' },
            timestamp: Date.now(),
            message: { mid: 'mid1', text: 'こんにちは' },
          },
          {
            sender: { id: '30' },
            recipient: { id: 'other' },
            timestamp: Date.now(),
            message: { mid: 'mid2', text: '別' },
          },
        ],
      },
    ],
  });
  const signature = await signed(raw);
  expect(
    await verifyInstagramSignature(
      raw + ' ',
      signature,
      config.META_APP_SECRET,
    ),
  ).toBe(false);
  expect(
    (
      await publicApp.request('/api/instagram/webhook', {
        method: 'POST',
        body: raw,
      })
    ).status,
  ).toBe(401);
  for (let i = 0; i < 2; i++)
    expect(
      (
        await publicApp.request('/api/instagram/webhook', {
          method: 'POST',
          headers: { 'X-Hub-Signature-256': signature },
          body: raw,
        })
      ).status,
    ).toBe(200);
  const messages = await read(await req('/api/instagram/messages'));
  expect(messages.data.total).toBe(1);
  const previous = vi.mocked(fetch).mock.calls.length;
  expect(
    (await req('/api/instagram/messages/mid1/reply', { text: '返信' })).status,
  ).toBe(403);
  expect(vi.mocked(fetch).mock.calls).toHaveLength(previous);
  db.raw.exec("UPDATE instagram_messages SET created_at='2000-01-01'");
  await purgeInstagramTransientData(db.db);
  expect(
    db.raw.prepare('SELECT COUNT(*) n FROM instagram_messages').get(),
  ).toEqual({ n: 0 });
});

it('壊れた設定・署名済みの壊れた本文・偽のページ候補を外へ進めない', async () => {
  expect(
    instagramConfig({
      ...config,
      META_TOKEN_ENCRYPTION_KEY: 'broken',
    } as Env['Bindings']),
  ).toBe(null);
  for (const raw of [
    'null',
    '{',
    '{"object":"instagram","entry":[null,{"id":"20","messaging":{}}]}',
  ]) {
    const r = await app().request('/api/instagram/webhook', {
      method: 'POST',
      body: raw,
      headers: { 'X-Hub-Signature-256': await signed(raw) },
    });
    expect(r.status).toBe(raw === '{' ? 400 : 200);
  }
  // 期限切れの state では Meta へ一度も問い合わせず、画面へ失敗だけ返す。
  const start = await read(await req('/api/instagram/oauth/start', {})),
    state = new URL(start.data.url).searchParams.get('state')!;
  db.raw.exec("UPDATE instagram_oauth_states SET expires_at='2000-01-01'");
  const calls = vi.mocked(fetch).mock.calls.length;
  const expired = await req(
    '/api/instagram/oauth/callback?' +
      new URLSearchParams({ state, code: 'mock' }),
  );
  expect(expired.status).toBe(302);
  expect(expired.headers.get('location')).toContain('instagram=failed');
  expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
});

/**
 * Meta のエラー説明文（`error.message`）は Meta が書く自由な文章で、こちらが送った値
 * （合鍵・アプリシークレット・認可コード）がそのまま、あるいは URL エンコード・二重エンコード
 * など様々な形で混ざって返ることがある。表現の形を網羅して伏せ字にするやり方は新しい形が
 * 見つかるたびに後追いになるため、`message` 自体を記録に出さないようにした。
 * どんな形で秘密値が混ざっていても記録に一切残らないこと、原因調べに使う種別・番号
 * （`status` / `type` / `code` / `subcode`）は残ることを確かめる。
 */
it('Metaのエラー説明文は、秘密値がどんな形で混ざっていても一切サーバー記録に出さない', async () => {
  const longToken = 'EAAI9x+9ZaOp/ZBdBO1234567890ABCDEFG=';
  const doubleEncoded = encodeURIComponent(encodeURIComponent(longToken));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string) =>
      Response.json(
        {
          error: {
            type: 'OAuthException',
            code: 100,
            error_subcode: 33,
            // Meta がこちらの送った値を、そのまま・URLエンコード・二重エンコードと
            // 混在した形で返してきた最悪の場合を模す。
            message:
              `Invalid request: ${String(url)} ` +
              `client_secret=${config.META_APP_SECRET} code=mock_code ` +
              `access_token=${longToken} ` +
              `access_token_encoded=${doubleEncoded}`,
          },
        },
        { status: 400 },
      ),
    ),
  );
  const logged: string[] = [];
  const spy = vi
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  let location = '';
  try {
    const start = await read(await req('/api/instagram/oauth/start', {})),
      state = new URL(start.data.url).searchParams.get('state')!;
    const callback = await req(
      '/api/instagram/oauth/callback?' +
        new URLSearchParams({ state, code: 'mock_code' }),
    );
    expect(callback.status).toBe(302);
    location = callback.headers.get('location') ?? '';
    expect(location).toContain('instagram=failed');
  } finally {
    spy.mockRestore();
  }
  const record = logged.find((line) =>
    line.includes('instagram_oauth_callback_failed'),
  );
  expect(record).toBeDefined();
  // 原因調べに使う種別・番号は残る。
  expect(record).toContain('type=OAuthException');
  expect(record).toContain('code=100');
  expect(record).toContain('subcode=33');
  // 説明文（message）自体を記録に出さないため、どの表現も残らない。
  expect(record).not.toContain('message=');
  for (const secret of [
    config.META_APP_SECRET,
    'mock_code',
    longToken,
    encodeURIComponent(longToken),
    doubleEncoded,
    config.META_TOKEN_ENCRYPTION_KEY,
  ])
    expect(logged.join('\n')).not.toContain(secret);
  // 戻り先URLにも同じ手がかりを添えるので、そこにも秘密値が移らないことを確かめる。
  // URLは値をエンコードして持つため、元に戻した形でも照合する。
  const returned = `${location}\n${decodeURIComponent(location)}`;
  expect(location).toContain('instagram_detail=');
  for (const secret of [
    config.META_APP_SECRET,
    'mock_code',
    longToken,
    encodeURIComponent(longToken),
    doubleEncoded,
    config.META_TOKEN_ENCRYPTION_KEY,
  ])
    expect(returned).not.toContain(secret);
});

/**
 * 戻り先URLは利用者に見える場所なので、Meta の応答から来る値をそのまま置かない。
 * Meta は応答の中身（`error.type` や `debug_token` の権限名）を自由に決められるため、
 * 「自由文ではない項目」という理由だけでは守れない。ここでは**英小文字32文字**という、
 * 合鍵のような見た目でありながら名前の形としては通ってしまう試験用の値を混ぜて、
 * 形での見分けではなく**許可一覧**が効いていることを確かめる。実在する秘密値は使わない。
 */
it('模擬応答の種別名・権限名に秘密値のような値が混ざっても、記録と戻り先URLのどちらにも出さない', async () => {
  // 実在しない試験用の値。英小文字だけなので「ありそうな名前の形」には当てはまる。
  const synthetic = 'abcdefabcdefabcdefabcdefabcdefab';
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      // 許可された権限の名前に試験用の値が混ざった場合を模す。
      if (path.endsWith('/debug_token'))
        return Response.json({
          data: {
            is_valid: true,
            app_id: '100',
            expires_at: Math.floor(Date.now() / 1000) + 60 * 86400,
            scopes: [
              'pages_show_list',
              synthetic,
              'instagram_content_publish',
            ],
          },
        });
      // 種別名・番号に試験用の値が混ざった場合を模す（番号は整数ですらない）。
      if (path.endsWith('/me/accounts'))
        return Response.json(
          {
            error: {
              type: synthetic,
              code: `100${synthetic}`,
              error_subcode: synthetic,
              message: `secret=${synthetic}`,
            },
          },
          { status: 400 },
        );
      return original(url, init);
    }),
  );
  const logged: string[] = [];
  const spy = vi
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  let location = '';
  try {
    const start = await read(await req('/api/instagram/oauth/start', {})),
      state = new URL(start.data.url).searchParams.get('state')!;
    const callback = await req(
      '/api/instagram/oauth/callback?' +
        new URLSearchParams({ state, code: 'mock_code' }),
    );
    expect(callback.status).toBe(302);
    location = callback.headers.get('location') ?? '';
  } finally {
    spy.mockRestore();
  }
  const back = new URL(location);
  expect(back.searchParams.get('instagram')).toBe('failed');
  // 失敗の種類名はこちらが決めた固定の文言。
  expect(back.searchParams.get('instagram_code')).toBe('meta_request_failed');
  // 許可一覧に無い種別名は中身を出さず `other` に置き換える。検査を通らない番号は落とす。
  expect(back.searchParams.get('instagram_detail')).toBe(
    'GET v24.0/me/accounts status=400 type=other',
  );
  // 許可一覧に無い権限名も中身を出さず、件数だけを添える。
  expect(back.searchParams.get('instagram_scopes')).toBe(
    'pages_show_list,instagram_content_publish,other1',
  );
  // 記録と戻り先URL（元に戻した形も）のどちらにも試験用の値は出ない。
  const returned = `${location}\n${decodeURIComponent(location)}`;
  expect(logged.join('\n')).not.toContain(synthetic);
  expect(returned).not.toContain(synthetic);
  // 絞り込みは境目でも二重に効く。仮に手がかりへ自由文が入り込んでも通さない。
  expect(
    instagramUrlDetail(
      `GET v24.0/me/accounts status=400 type=${synthetic} code=${synthetic}`,
    ),
  ).toBe('GET v24.0/me/accounts status=400 type=other');
  expect(instagramUrlScopes(`pages_show_list,${synthetic}`)).toBe(
    'pages_show_list,other1',
  );
});

/**
 * Meta から応答が返らなかった場合。これまでは `meta_unavailable` だけで、
 * **どの要求で止まったのか**も**時間切れなのか接続不可なのか**も分からなかった。
 * 要求の宛先と呼び名を残す（呼び名は許可一覧のみ。自由文の `message` は読まない）。
 */
it.each([
  // 時間切れ（Meta が遅い／通信が出られない）
  ['TimeoutError', 'TimeoutError'],
  // つなげなかった（名前が引けない・接続できない・許していない転送）
  ['TypeError', 'TypeError'],
  // 許可一覧に無い呼び名は中身を出さない
  ['abcdefabcdefabcdefabcdefabcdefab', 'other'],
])(
  '折り返しの最初の要求で応答が返らないとき、どの要求で止まったかと呼び名（%s）を戻り先URLへ残す',
  async (thrownName, expected) => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        if (new URL(String(url)).pathname.endsWith('/oauth/access_token')) {
          // 応答を返さず投げる。自由文には秘密値のような値を入れておく。
          const e = new Error(`secret=${thrownName}`);
          e.name = thrownName;
          throw e;
        }
        return original(url, init);
      }),
    );
    const logged: string[] = [];
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    let location = '';
    try {
      const start = await read(await req('/api/instagram/oauth/start', {})),
        state = new URL(start.data.url).searchParams.get('state')!;
      const callback = await req(
        '/api/instagram/oauth/callback?' +
          new URLSearchParams({ state, code: 'mock_code' }),
      );
      expect(callback.status).toBe(302);
      location = callback.headers.get('location') ?? '';
    } finally {
      spy.mockRestore();
    }
    const back = new URL(location);
    expect(back.searchParams.get('instagram')).toBe('failed');
    expect(back.searchParams.get('instagram_code')).toBe('meta_unavailable');
    expect(back.searchParams.get('instagram_detail')).toBe(
      `GET v24.0/oauth/access_token fetch=${expected}`,
    );
    // 自由文（`message`）は記録にも戻り先URLにも出さない。
    const returned = `${location}\n${decodeURIComponent(location)}`;
    expect(logged.join('\n')).not.toContain('secret=');
    expect(returned).not.toContain('secret');
    // 境目でも同じ許可一覧で絞り直す。
    expect(
      instagramUrlDetail(
        'GET v24.0/oauth/access_token fetch=abcdefabcdefabcdefabcdefabcdefab',
      ),
    ).toBe('GET v24.0/oauth/access_token fetch=other');
  },
);

it('写真DMと受信時刻の順、別アカウントのカーソルを守る', async () => {
  await connect();
  const messages = [
    { mid: 'z-old', text: '古い' },
    {
      mid: 'a-new',
      attachments: [
        {
          type: 'image',
          payload: { url: 'https://cdn.example.test/photo.jpg' },
        },
        { type: 'image', payload: { url: 'javascript:alert(1)' } },
      ],
    },
  ];
  const raw = JSON.stringify({
    object: 'instagram',
    entry: [
      {
        id: '20',
        messaging: messages.map((message, i) => ({
          sender: { id: '30' },
          recipient: { id: '20' },
          timestamp: Date.now() + i,
          message,
        })),
      },
    ],
  });
  expect(
    (
      await app().request('/api/instagram/webhook', {
        method: 'POST',
        body: raw,
        headers: { 'X-Hub-Signature-256': await signed(raw) },
      })
    ).status,
  ).toBe(200);
  const res = await req('/api/instagram/messages?limit=1');
  const result = (await res.json()) as {
    data: {
      messages: Array<{
        id: string;
        attachments: Array<{ url: string | null }>;
      }>;
    };
  };
  expect(result.data.messages[0]).toMatchObject({
    id: 'a-new',
    attachments: [{ url: 'https://cdn.example.test/photo.jpg' }, { url: null }],
  });
  expect(
    (await read(await req('/api/instagram/messages?beforeId=a-new'))).data
      .messages,
  ).toMatchObject([{ id: 'z-old' }]);
  expect((await req('/api/instagram/messages?beforeId=foreign')).status).toBe(
    404,
  );
});
