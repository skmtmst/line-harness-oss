/*
 * #673（点検 #617 N-033）のアカウント境界の結合試験。
 *
 * 画面の作り物ではなく、apps/worker の**本物のルート**を Hono に載せて叩く。
 * 固定の403を返す作り物では、受信箱の deep-link が守っている境界が
 * 本当に必要なのかを証明できないため、ここでは実装そのものを動かす。
 *
 * 証明したいこと:
 *   - `GET /api/chats/:id` は「見る権限」しか見ない。A社とB社の両方を
 *     見られる担当者には、B社を選んで作業中でもA社の会話を200で返す。
 *     つまり送信元の取り違えは画面側で止めるしかない。
 *   - `GET /api/friends/:id` は `lineAccountId` を返す。受信箱の
 *     deep-link はこの値で選択中アカウントへ固定している。
 *   - 見る権限そのものの壁（別統括・担当外アカウント）は今までどおり
 *     404 のまま。今回の修正で緩めていない。
 */
import { beforeEach, describe, expect, test } from 'vitest'

// 本物のルート。web からの相対 import で、実装を直接読み込む。
import { chats } from '../../../../worker/src/routes/chats.js'
import { friends } from '../../../../worker/src/routes/friends.js'

const ACCOUNT_A = 'account-a'
const ACCOUNT_B = 'account-b'
const TENANT = 'default'

type Row = Record<string, unknown>

/** この試験で使う D1 の中身。実際の列名で持つ。 */
type Fixture = {
  lineAccounts: Row[]
  staffMembers: Row[]
  staffAccountScopes: Row[]
  friends: Row[]
  chats: Row[]
  messagesLog: Row[]
}

function fixture(): Fixture {
  const account = (id: string) => ({
    id,
    tenant_id: TENANT,
    parent_line_account_id: null,
    is_active: 1,
    archived_at: null,
    login_channel_id: null,
    liff_id: null,
    display_order: 1,
    created_at: '2026-01-01T00:00:00.000Z',
  })
  const friend = (id: string, accountId: string, name: string) => ({
    id,
    line_account_id: accountId,
    line_user_id: `U-${id}`,
    display_name: name,
    real_name: null,
    system_display_name: null,
    picture_url: null,
    status_message: null,
    is_following: 1,
    metadata: '{}',
    ref_code: null,
    user_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  })
  return {
    lineAccounts: [account(ACCOUNT_A), account(ACCOUNT_B)],
    staffMembers: [{
      id: 'staff-1',
      name: '両方見られる担当',
      tenant_id: TENANT,
      role: 'owner',
      // 'accounts' なら担当アカウントだけ。'all' は統括の全アカウント。
      account_scope: 'all',
      created_at: '2026-01-01T00:00:00.000Z',
    }],
    staffAccountScopes: [],
    friends: [
      friend('friend-a', ACCOUNT_A, 'A社 太郎'),
      friend('friend-b', ACCOUNT_B, 'B社 花子'),
    ],
    chats: [],
    messagesLog: [{
      id: 'message-a',
      friend_id: 'friend-a',
      direction: 'incoming',
      message_type: 'text',
      content: 'A社あての問い合わせ',
      source: 'line',
      origin_kind: null,
      sent_by_staff_id: null,
      sent_by_staff_name: null,
      scenario_name: null,
      delivery_type: null,
      created_at: '2026-09-09T00:00:00.000Z',
    }],
  }
}

/**
 * SQL の本文で振り分ける最小の D1。
 *
 * 本物のルートが投げる問い合わせだけを見て、それ以外は空で返す。
 * 空で返す先は今回の判定に関わらない（フォーム回答やタグなど）。
 */
function createDb(data: Fixture): unknown {
  const run = (sql: string, binds: unknown[]): Row[] => {
    const text = sql.replace(/\s+/g, ' ').trim()
    if (text.includes('FROM line_accounts')) return data.lineAccounts
    if (text.includes('FROM staff_members WHERE id = ?')) {
      return data.staffMembers.filter((row) => row.id === binds[0])
    }
    if (text.includes('FROM staff_account_scopes')) {
      return data.staffAccountScopes.filter((row) => row.staff_id === binds[0])
    }
    if (text.includes('FROM chats WHERE id = ?')) {
      return data.chats.filter((row) => row.id === binds[0])
    }
    if (text.includes('FROM chats WHERE friend_id = ?') || text.includes('FROM chats c')) {
      return data.chats.filter((row) => row.friend_id === binds[0])
    }
    if (text.includes('FROM friends WHERE id = ?')) {
      return data.friends.filter((row) => row.id === binds[0])
    }
    if (text.includes('FROM messages_log')) {
      return data.messagesLog.filter((row) => row.friend_id === binds[0])
    }
    return []
  }
  const prepare = (sql: string) => {
    let binds: unknown[] = []
    const statement = {
      bind: (...values: unknown[]) => { binds = values; return statement },
      first: async () => run(sql, binds)[0] ?? null,
      all: async () => ({ results: run(sql, binds) }),
      run: async () => ({}),
    }
    return statement
  }
  return { prepare }
}

/** 試験で使う分だけの Hono の形。 */
type RouteApp = {
  request: (input: string, init?: RequestInit, env?: unknown) => Promise<Response>
  use: (path: string, middleware: unknown) => unknown
  route: (path: string, app: unknown) => unknown
}

/**
 * 本物のルートを載せる入れ物。
 *
 * web は hono を依存に持たないので、ルート自身の constructor から
 * 同じ Hono を借りる。試験のために web の依存を増やさない。
 */
function createHost(): RouteApp {
  const ctor = (chats as unknown as { constructor: new () => RouteApp }).constructor
  return new ctor()
}

type StaffOverride = { accountScope?: 'all' | 'accounts'; scopeIds?: string[]; tenantId?: string }

function app(data: Fixture, staff: StaffOverride = {}) {
  if (staff.accountScope) data.staffMembers[0]!.account_scope = staff.accountScope
  if (staff.scopeIds) {
    data.staffAccountScopes = staff.scopeIds.map((id) => ({ staff_id: 'staff-1', line_account_id: id }))
  }
  const host = createHost()
  host.use('*', async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    // 認証は本筋ではないので、認証済みの担当者をここで差し込む。
    c.set('staff', { id: 'staff-1', role: 'owner', tenantId: staff.tenantId ?? TENANT })
    await next()
  })
  host.route('/', chats)
  host.route('/', friends)
  const env = { DB: createDb(data) }
  return { request: (path: string) => host.request(path, undefined, env) }
}

let data: Fixture
beforeEach(() => { data = fixture() })

describe('#673 受信箱deep-linkのアカウント境界（実ルート結合）', () => {
  test('両アカウントを見られる担当には、実ルートが別アカウントの会話も200で返す', async () => {
    const response = await app(data).request('/api/chats/friend-a')
    expect(response.status).toBe(200)
    const body = await response.json() as {
      success: boolean
      data: { friendId: string; friendName: string; messages: Array<{ content: string }> }
    }
    expect(body.success).toBe(true)
    expect(body.data.friendId).toBe('friend-a')
    // 中身までA社の会話。B社を選んで作業していても、口は止めない。
    expect(body.data.messages.map((m) => m.content)).toContain('A社あての問い合わせ')
  })

  test('実ルートは友だちの所属アカウントを lineAccountId で返す', async () => {
    const response = await app(data).request('/api/friends/friend-a')
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { id: string; lineAccountId: string | null } }
    expect(body.data.id).toBe('friend-a')
    // 受信箱の deep-link はこの値だけを見て選択中アカウントへ固定する。
    expect(body.data.lineAccountId).toBe(ACCOUNT_A)

    const other = await app(fixture()).request('/api/friends/friend-b')
    const otherBody = await other.json() as { data: { lineAccountId: string | null } }
    expect(otherBody.data.lineAccountId).toBe(ACCOUNT_B)
  })

  test('見る権限が無いアカウントは今までどおり404のまま', async () => {
    const scoped = app(data, { accountScope: 'accounts', scopeIds: [ACCOUNT_B] })
    expect((await scoped.request('/api/chats/friend-a')).status).toBe(404)
    expect((await scoped.request('/api/friends/friend-a')).status).toBe(404)

    const allowed = app(fixture(), { accountScope: 'accounts', scopeIds: [ACCOUNT_B] })
    expect((await allowed.request('/api/friends/friend-b')).status).toBe(200)
  })

  test('別統括の担当には、どちらのアカウントも見せない', async () => {
    const foreign = app(data, { tenantId: 'other-tenant' })
    expect((await foreign.request('/api/chats/friend-a')).status).toBe(404)
    expect((await foreign.request('/api/friends/friend-b')).status).toBe(404)
  })
})
