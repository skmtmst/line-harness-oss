/*
 * テンプレート編集画面を、実際に mount して確かめる。
 *
 * **Required gate（`pnpm --filter web test`）から動きます。** 外に立てた
 * 画面サーバーもブラウザも要りません。本物の `TemplateEditInner` を本物の
 * React で組み立て、本物の効果を走らせ、本物のクリックを配ります。
 *
 * 見張る筋書きは、司令塔の再審査で挙がったものです。
 *
 *   1. `?id=A` を読み込む（保存できる）
 *   2. 同じ画面のまま `?id=B` へ替える
 *   3. **B の取得が返るまで、保存の口が開かない**
 *      （ここが開いていると、A の本文を `PUT /api/templates/B` へ送れる）
 *   4. B が返ってはじめて保存でき、送られるのは B の本文だけ
 *
 * あわせて、遅れて届いた A の応答が B を汚さないことも見ています。
 */
import React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  click,
  findById,
  findByLabel,
  findByText,
  installTestDom,
  isDisabled,
  type DomDocument,
  type DomElement,
} from './test-dom'

/* --------------------------------------------------- 画面まわりの置き換え */

/*
 * URL の読み取りだけ差し替える。**画面の中身は差し替えない。**
 * 実際の遷移は Next が受け持つので、ここでは「id が変わった」ことだけを
 * 同じ形で伝えられれば足りる。
 */
const routing = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: (_href: string) => {},
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (href: string) => routing.push(href),
    replace: (href: string) => routing.push(href),
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  }),
  useSearchParams: () => routing.params,
  usePathname: () => '/templates/edit',
}))

/* Link は行き先を出すだけの部品。画面の判断とは関わらない。 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

/* ------------------------------------------------------------ 読み込む口 */

let document: DomDocument
let createRoot: typeof import('react-dom/client').createRoot
let flushSync: typeof import('react-dom').flushSync
let act: typeof React.act
let AccountProvider: typeof import('@/contexts/account-context').AccountProvider
let useAccount: typeof import('@/contexts/account-context').useAccount
let Testing: typeof import('./page').default.__testing
let ADMIN_SESSION_STORAGE_KEY: string
let CSRF_STORAGE_KEY: string

const API = 'https://worker.example.com'
const SESSION = 'mount-session'
const CSRF = 'mount-csrf'

beforeAll(async () => {
  // DOM は `react-dom/client` より先。読み込み時に window.document を見る。
  document = installTestDom()
  const view = globalThis as unknown as Record<string, unknown>
  view.IS_REACT_ACT_ENVIRONMENT = true
  /*
   * 画面の tsx は `jsx: preserve` で書かれており、この試験の変換では
   * `React.createElement` になる。`import React` を書いていないファイル
   * （共通の文脈や部品）もそのまま組み立てられるよう、全体へ置く。
   */
  view.React = React
  process.env.NEXT_PUBLIC_API_URL = API
  ;({ createRoot } = await import('react-dom/client'))
  ;({ flushSync } = await import('react-dom'))
  act = (await import('react')).act
  ;({ ADMIN_SESSION_STORAGE_KEY } = await import('@/lib/admin-session'))
  ;({ CSRF_STORAGE_KEY } = await import('@/lib/api'))
  ;({ AccountProvider, useAccount } = await import('@/contexts/account-context'))
  Testing = (await import('./page')).default.__testing
})

/* ------------------------------------------------------- 自己完結の偽API */

type Account = 'account-a' | 'account-b'

/*
 * `tmpl-a1` と `tmpl-a2` は同じアカウント。**id を替えたときの穴だけを
 * 見たいので、アカウントは動かさない。** `tmpl-b` は別アカウントで、
 * 所属ちがいの見張りに使う。
 */
const TEMPLATES: Record<string, { accountId: Account; name: string; body: string }> = {
  'tmpl-a1': { accountId: 'account-a', name: 'A店の定期便', body: 'A店の定期便の本文 {{field.a_pet}}' },
  'tmpl-a2': { accountId: 'account-a', name: 'A店の再入荷のお知らせ', body: 'A店の再入荷の本文 {{field.a_pet}}' },
  'tmpl-b': { accountId: 'account-b', name: 'B店のご案内', body: 'B店の本文 {{field.b_plan}}' },
}

const FIELD_OF: Record<Account, { key: string; name: string }> = {
  'account-a': { key: 'a_pet', name: 'A店のペット名' },
  'account-b': { key: 'b_plan', name: 'B店のコース' },
}

interface Write {
  method: string
  path: string
  body: Record<string, unknown> | null
}

let writes: Write[] = []
/** 保留させたい取得。鍵は `/api/templates/tmpl-b` のような道筋。 */
let held: Map<string, { promise: Promise<void>; release: () => void }> = new Map()

function hold(path: string) {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  const entry = { promise, release }
  held.set(path, entry)
  return entry
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function fakeApi(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input)
  const headers = new Headers(init?.headers as HeadersInit | undefined)
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname

  if (method !== 'GET') {
    // 書き込む口は、ログインと合言葉が揃っていなければ受け付けない。
    if (headers.get('Authorization') !== `Bearer lh_session:${SESSION}`) {
      return jsonResponse({ success: false, error: 'unauthorized' }, 401)
    }
    if (headers.get('X-CSRF-Token') !== CSRF) {
      return jsonResponse({ success: false, error: 'csrf' }, 403)
    }
    writes.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null })
    return jsonResponse({ success: true, data: { id: path.split('/').pop() } })
  }

  await held.get(path)?.promise

  if (path === '/api/line-accounts') {
    return jsonResponse({ success: true, data: [
      lineAccount('account-a', 'A店'),
      lineAccount('account-b', 'B店'),
    ] })
  }
  if (path === '/api/folders') {
    return jsonResponse({ success: true, data: [] })
  }
  if (path === '/api/friend-fields' || path === '/api/common-vars') {
    const accountId = (url.searchParams.get('lineAccountId') ?? url.searchParams.get('accountId')) as Account
    const field = FIELD_OF[accountId]
    if (!field) return jsonResponse({ success: false, error: 'forbidden' }, 403)
    return jsonResponse({ success: true, data: path === '/api/friend-fields'
      ? [friendField(accountId, field.key, field.name)]
      : [] })
  }
  const templateId = /^\/api\/templates\/([^/]+)$/.exec(path)?.[1]
  if (templateId) {
    const template = TEMPLATES[templateId]
    if (!template) return jsonResponse({ success: false, error: 'not found' }, 404)
    return jsonResponse({ success: true, data: {
      id: templateId,
      accountId: template.accountId,
      name: template.name,
      category: 'general',
      messageType: 'text',
      messageContent: template.body,
      folderId: null,
      question: null,
      questionStatus: 'draft',
      carouselActions: null,
      carouselTapLimitMode: 'none',
      carouselTapLimitText: null,
      usedBy: {
        autoReplies: [], automations: [], scenarioSteps: [],
        reminderSteps: [], richMenuAreas: [], trackedLinks: [],
      },
      createdAt: '', updatedAt: '',
    } })
  }
  return jsonResponse({ success: false, error: 'not found' }, 404)
}

const lineAccount = (id: Account, name: string) => ({
  id, channelId: `channel-${id}`, name, displayName: name, isActive: true,
  country: 'JP', role: 'admin', displayOrder: 0,
})

const friendField = (accountId: Account, fieldKey: string, name: string) => ({
  id: `${accountId}-${fieldKey}`, folderId: null, name, fieldKey, type: 'text',
  options: null, defaultValue: '見本', source: 'manual', ecFieldPath: null,
  ecIsMaster: false, isPersonal: false, isStarred: false, displayOrder: 0,
  canInsertText: true, createdAt: '', updatedAt: '',
})

/* -------------------------------------------------------------- 組み立て */

let accountApi: { setSelectedAccountId: (id: string) => void } | null = null

function AccountProbe() {
  accountApi = useAccount()
  return null
}

function Screen() {
  return (
    <AccountProvider>
      <AccountProbe />
      <Testing.TemplateEditInner />
    </AccountProvider>
  )
}

let container: DomElement
let root: ReturnType<typeof createRoot>

/** 効果と、その中で待っている約束が片付くまで進める。 */
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function mountAt(search: string) {
  routing.params = new URLSearchParams(search)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<Screen />) })
  await settle()
}

/**
 * 効果を走らせずに、描き直した直後の画面だけを見る。
 *
 * **利用者が触れるのは、この一瞬を含めた画面すべて。** id を替えたときの
 * 後片付けを効果に任せると、ここで一度だけ「前の本文・前の所属・新しい
 * 送り先」が揃った画面が出て、その瞬間の押下で前の本文が新しい id へ入る。
 */
function renderWithoutEffects(search: string) {
  routing.params = new URLSearchParams(search)
  const view = globalThis as unknown as Record<string, unknown>
  view.IS_REACT_ACT_ENVIRONMENT = false
  try {
    flushSync(() => { root.render(<Screen />) })
  } finally {
    view.IS_REACT_ACT_ENVIRONMENT = true
  }
}

/** URL の id だけ替えて、同じ画面を描き直す。mount はやり直さない。 */
async function navigateTo(search: string) {
  routing.params = new URLSearchParams(search)
  await act(async () => { root.render(<Screen />) })
  await settle()
}

const saveButton = () => findByText(container, 'button', '保存')
/*
 * 見比べるのは値だけにする。DOM の節をそのまま `expect` へ渡すと、
 * 落ちたときに節の中身を延々と書き出そうとして、**どの条件で落ちたのかが
 * 読めなくなる。**
 */
const hasSaveButton = () => saveButton() !== null
const nameValue = () => findById(container, 'tp-name')?.value ?? null
const insertOptions = () => findByLabel(container, '友だち情報を差し込む')?.textContent ?? null
const screenText = () => container.textContent

beforeEach(() => {
  writes = []
  held = new Map()
  accountApi = null
  routing.push = () => {}

  const store = (initial: Record<string, string>) => {
    const map = new Map(Object.entries(initial))
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    }
  }
  vi.stubGlobal('sessionStorage', store({ [ADMIN_SESSION_STORAGE_KEY]: SESSION }))
  vi.stubGlobal('localStorage', store({
    [CSRF_STORAGE_KEY]: CSRF,
    lh_selected_account: 'account-a',
  }))
  vi.stubGlobal('fetch', vi.fn(fakeApi))
})

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  vi.unstubAllGlobals()
})

/* ================================================================ 筋書き */

describe('同じ画面のまま編集するテンプレートを替える', () => {
  it('次のテンプレートが返るまで保存を閉じ、返ってからその本文だけを送る', async () => {
    await mountAt('?id=tmpl-a1')

    // --- 1. 1本目を読み終えた。保存できる。
    expect(nameValue()).toBe('A店の定期便')
    expect(hasSaveButton()).toBe(true)
    expect(isDisabled(saveButton())).toBe(false)

    // --- 2. 2本目の取得を保留したまま、同じ画面で id を替える。
    const pending = hold('/api/templates/tmpl-a2')
    await navigateTo('?id=tmpl-a2')

    /*
     * ここが差し戻しの中身。**保存の口が開いていると、画面に残った
     * 1本目の本文を `PUT /api/templates/tmpl-a2` へ送れてしまう。**
     */
    expect(hasSaveButton()).toBe(false)
    expect(screenText()).toContain('読み込み中')
    // 1本目の中身が1文字も残っていない。残っていれば、それが送られる元になる。
    expect(screenText()).not.toContain('A店の定期便')
    expect(nameValue()).toBeNull()
    expect(writes).toEqual([])

    // --- 3. 2本目が返ってはじめて保存できる。
    pending.release()
    await settle()

    expect(nameValue()).toBe('A店の再入荷のお知らせ')
    expect(hasSaveButton()).toBe(true)
    expect(isDisabled(saveButton())).toBe(false)

    // --- 4. 送られるのは2本目の本文だけ。1本目へは1件も出ない。
    const pushed: string[] = []
    routing.push = (href) => pushed.push(href)
    await act(async () => { click(saveButton()!) })
    await settle()

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ method: 'PUT', path: '/api/templates/tmpl-a2' })
    expect(writes[0].body).toMatchObject({
      name: 'A店の再入荷のお知らせ',
      messageContent: 'A店の再入荷の本文 {{field.a_pet}}',
    })
    expect(writes.some((write) => write.path === '/api/templates/tmpl-a1')).toBe(false)
    expect(pushed).toEqual(['/templates'])
  })

  it('id を替えた直後の一瞬にも、前の本文と新しい送り先が並ばない', async () => {
    await mountAt('?id=tmpl-a1')
    expect(nameValue()).toBe('A店の定期便')

    hold('/api/templates/tmpl-a2')
    // 効果より前、描き直した直後の画面。ここで既に前の中身が消えている。
    renderWithoutEffects('?id=tmpl-a2')

    expect(hasSaveButton()).toBe(false)
    expect(nameValue()).toBeNull()
    expect(screenText()).not.toContain('A店の定期便')
    expect(screenText()).toContain('読み込み中')

    await settle()
    expect(writes).toEqual([])
  })

  it('別アカウントのテンプレートへ替えると、取得後も所属ちがいで保存を閉じたまま', async () => {
    await mountAt('?id=tmpl-a1')
    expect(isDisabled(saveButton())).toBe(false)

    const pending = hold('/api/templates/tmpl-b')
    await navigateTo('?id=tmpl-b')

    // 取得中は口そのものが無い。
    expect(hasSaveButton()).toBe(false)
    expect(writes).toEqual([])

    pending.release()
    await settle()

    // 取得後も、上のバーは A店 のまま。所属ちがいなので閉じ続ける。
    expect(nameValue()).toBe('B店のご案内')
    expect(screenText()).toContain(Testing.ACCOUNT_MISMATCH_MESSAGE)
    expect(isDisabled(saveButton())).toBe(true)
    await act(async () => { click(saveButton()!) })
    await settle()
    expect(writes).toEqual([])
  })

  it('差し込み候補も、次のテンプレートが返るまで前のものを出さない', async () => {
    await mountAt('?id=tmpl-a1')
    expect(insertOptions()).toContain('A店のペット名')

    const pending = hold('/api/templates/tmpl-b')
    await navigateTo('?id=tmpl-b')
    expect(insertOptions()).toBeNull()

    pending.release()
    await settle()

    expect(insertOptions()).toContain('B店のコース')
    expect(insertOptions()).not.toContain('A店のペット名')
  })

  it('遅れて届いた前のテンプレートの応答が、いまの画面を書き換えない', async () => {
    // 1本目を保留したまま開き、返らないうちに2本目へ替える。
    const pendingFirst = hold('/api/templates/tmpl-a1')
    await mountAt('?id=tmpl-a1')
    expect(hasSaveButton()).toBe(false)

    await navigateTo('?id=tmpl-a2')
    expect(nameValue()).toBe('A店の再入荷のお知らせ')

    // ここで1本目がようやく返る。現世代ではないので、捨てられる。
    pendingFirst.release()
    await settle()

    expect(nameValue()).toBe('A店の再入荷のお知らせ')
    expect(screenText()).not.toContain('A店の定期便')
    expect(isDisabled(saveButton())).toBe(false)

    // 保存しても、送り先も中身も2本目のまま。
    await act(async () => { click(saveButton()!) })
    await settle()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ method: 'PUT', path: '/api/templates/tmpl-a2' })
    expect(writes[0].body).toMatchObject({ messageContent: 'A店の再入荷の本文 {{field.a_pet}}' })
  })

  it('読み込めなかったテンプレートは、保存を閉じたまま理由を出す', async () => {
    await mountAt('?id=tmpl-missing')

    expect(screenText()).toContain(Testing.TEMPLATE_LOAD_FAILED_MESSAGE)
    expect(isDisabled(saveButton())).toBe(true)
    await act(async () => { click(saveButton()!) })
    expect(writes).toEqual([])
  })
})

describe('上のバーでアカウントを替える', () => {
  it('A のテンプレートを開いたまま B を選ぶと、保存を閉じて候補は A のまま', async () => {
    await mountAt('?id=tmpl-a1')
    expect(isDisabled(saveButton())).toBe(false)

    await act(async () => { accountApi?.setSelectedAccountId('account-b') })
    await settle()

    expect(screenText()).toContain(Testing.ACCOUNT_MISMATCH_MESSAGE)
    expect(screenText()).toContain('このテンプレートは「A店」のものです')
    expect(isDisabled(saveButton())).toBe(true)
    expect(insertOptions()).toContain('A店のペット名')

    // 押しても通信は出ない。塞いだ見た目だけでなく、送る口も閉じている。
    await act(async () => { click(saveButton()!) })
    await settle()
    expect(writes).toEqual([])

    // 戻せば、また保存できる。
    await act(async () => { accountApi?.setSelectedAccountId('account-a') })
    await settle()
    expect(isDisabled(saveButton())).toBe(false)
    expect(screenText()).not.toContain(Testing.ACCOUNT_MISMATCH_MESSAGE)
  })
})

describe('新しく作る', () => {
  it('id が無ければ最初から書けて、選んでいるアカウントの候補が並ぶ', async () => {
    await mountAt('')

    expect(nameValue()).toBe('')
    expect(hasSaveButton()).toBe(true)
    expect(isDisabled(saveButton())).toBe(false)
    expect(insertOptions()).toContain('A店のペット名')
  })
})
