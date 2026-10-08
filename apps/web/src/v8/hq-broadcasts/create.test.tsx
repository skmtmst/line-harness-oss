// @vitest-environment happy-dom
/*
 * 統括 一括配信を作る（B-37・BBRDb：店の一斉配信と同じ5段＋送るアカウント）・詳細（xOXuY）の動きの試験。
 * ① 配信名 → ② 送るアカウント（カードにチェック）→ ③ 本文 → ④ 時刻 → ⑤ 確かめる（作る → preflight → 問題のある店を外す）→ 送る（確かめの窓 → send）。
 * 詳細は失敗した店へのやり直し。閲覧のみ（担当者）には作る画面を出さない。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hq = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), get: vi.fn(), preflight: vi.fn(), exclude: vi.fn(), send: vi.fn(), stop: vi.fn(), cancel: vi.fn(), retry: vi.fn(),
  /* API-18：フォルダ・承認・テスト送信。承認が要らない（人数が少ない）ときの返事。 */
  folders: vi.fn(async () => ({ success: true, data: [] })),
  approvalCandidates: vi.fn(async () => ({ success: true, data: [] })),
  approval: vi.fn(async () => ({ success: true, data: { approval: { status: 'none', requestedByStaffId: null, requestedAt: null, approverStaffId: null, note: null, decidedByStaffId: null, decidedAt: null, rejectReason: null, confirmedCount: null }, gate: { required: false, recipientCount: 0, threshold: 1000, singleOperator: false, operatorCount: 2 }, viewer: { isApprover: false, canApprove: false, isRequester: false } } })),
  testSend: vi.fn(),
}))
const accounts = vi.hoisted(() => vi.fn())
const folders = vi.hoisted(() => vi.fn())
const tagList = vi.hoisted(() => vi.fn())
const assets = vi.hoisted(() => vi.fn())
const upload = vi.hoisted(() => vi.fn())
const tpl = vi.hoisted(() => ({ folders: { list: vi.fn(async () => []) }, listByKind: vi.fn(async (kind?: string) => { void kind; return [] as unknown[] }), get: vi.fn(), create: vi.fn(), uploadRichMessageImage: vi.fn() }))
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const push = vi.hoisted(() => vi.fn())
const replace = vi.hoisted(() => vi.fn())
const params = vi.hoisted(() => ({ value: new URLSearchParams() }))

vi.mock('@/lib/hq-broadcasts-api', () => ({ hqBroadcastsApi: hq }))
vi.mock('@/lib/hq-templates-api', () => ({ hqTemplatesApi: tpl }))
/*
 * その場で作る：店のカルーセル・リッチメッセージの作る部品（host の口）は、ここでは口だけの代わりにする。
 * 本物の部品の動きは templates/carousel・template-edit/rich の試験が見る。ここで見るのは、組み立てた中身が吹き出しに入ること。
 */
vi.mock('@/v8/templates/carousel', () => ({
  default: ({ host }: { host: { onSave: (content: unknown, distribute: boolean) => void; onCancel: () => void; primaryLabel?: string } }) => React.createElement('div', null,
    React.createElement('button', { type: 'button', onClick: () => host.onSave({ kind: 'carousel', name: 'その場のカルーセル', messageContent: JSON.stringify([{ title: 'A', text: 'a', actions: [{ type: 'uri', label: '見る', uri: 'https://shop.example/a' }] }, { title: 'B', text: 'b', actions: [{ type: 'uri', label: '見る', uri: 'https://shop.example/b' }] }]), tapLimitMode: 'none', tapLimitText: null }, true) }, host.primaryLabel),
    React.createElement('button', { type: 'button', onClick: host.onCancel }, 'キャンセル')),
}))
vi.mock('@/v8/template-edit/rich', () => ({
  default: ({ host }: { host: { onSave: (content: unknown, distribute: boolean) => void; primaryLabel?: string } }) => React.createElement('button', { type: 'button', onClick: () => host.onSave({ kind: 'rich_message', name: 'その場のリッチ', payload: { imageUrl: 'https://cdn.example/rich.png', baseUrl: 'https://cdn.example/rich', baseSize: { width: 1040, height: 1040 }, tapAreas: [{ x: 0, y: 0, width: 100, height: 100, actionType: 'uri', uri: 'https://shop.example/' }] }, media: [{ id: 'm1' }] }, true) }, host.primaryLabel),
}))
vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return { ...actual, api: { ...actual.api, lineAccounts: { list: accounts }, lineAccountFolders: { list: folders }, tags: { list: tagList }, broadcastMessageAssets: { list: assets, upload }, scenarios: { list: async () => ({ success: true, data: [] }) }, segmentPresets: { list: async () => ({ success: true, data: [] }) } } }
})
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => role.value, canManageRole: (r: string | null) => r === 'owner' || r === 'admin' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => params.value }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children) }))

import HqBroadcastCreate from './create'
import HqBroadcastDetail from './detail'

const check = (accountId: string, accountName: string, audienceCount: number, blockedReasons: string[] = []) => ({
  accountId, accountName, audienceCount, remaining: 10000, connected: true, paused: false, blockedReasons, excluded: false, broadcastId: null,
})
const folder = (id: string, name: string) => ({ id, kind: 'line_account', name, parentId: null, color: '#2f6fde', displayOrder: 1, createdAt: '', updatedAt: '' })

beforeEach(() => {
  role.value = 'owner'
  // 画面の住所（段の切り替えは同じ住所の中で履歴だけを書き換える）。
  window.history.replaceState(null, '', '/hq/broadcasts/new')
  params.value = new URLSearchParams()
  accounts.mockResolvedValue({ success: true, data: [
    { id: 'a1', name: '銀座店', tags: [{ id: 't1', name: '関東', color: null }], stats: { friendCount: 6120 }, folderId: 'f1', folder: folder('f1', '関東') },
    { id: 'a2', name: '新宿店', tags: [{ id: 't1', name: '関東', color: null }], stats: { friendCount: 5880 }, folderId: 'f1', folder: folder('f1', '関東') },
    { id: 'a3', name: '梅田店', tags: [{ id: 't2', name: '関西', color: null }], stats: { friendCount: 3950 }, folderId: 'f2', folder: folder('f2', '関西') },
  ] })
  folders.mockResolvedValue({ success: true, data: { folders: [folder('f1', '関東'), folder('f2', '関西')], total: 3, unclassifiedCount: 0 } })
  tagList.mockResolvedValue({ success: true, data: [{ id: 'x', name: 'VIP' }] })
  hq.list.mockResolvedValue({ data: [] })
  hq.create.mockImplementation(async (body: Record<string, unknown>) => ({ data: { id: 'run-1', title: 't', status: 'prepared', version: 1, scheduledAt: null, targets: [], input: body } }))
  hq.update.mockImplementation(async (id: string, body: Record<string, unknown>) => ({ data: { id, title: 't', status: 'prepared', version: Number(body.expectedVersion) + 1, scheduledAt: null, targets: [], input: body } }))
  assets.mockResolvedValue({ success: true, data: [
    { id: 'as-1', lineAccountId: null, kind: 'coupon', name: '冬の10%オフ', payload: { description: '会計から10%引き', startsAt: '2026-01-01', endsAt: '2026-01-31' }, createdAt: '', updatedAt: '' },
    { id: 'as-2', lineAccountId: 'a1', kind: 'coupon', name: '銀座店だけ', payload: {}, createdAt: '', updatedAt: '' },
  ] })
  hq.preflight.mockResolvedValue({ data: [check('a1', '銀座店', 6120), check('a2', '新宿店', 5880, ['今月の送信枠が足りません'])] })
  hq.exclude.mockResolvedValue({ data: { id: 'run-1', title: 't', status: 'prepared', version: 2, scheduledAt: null, targets: [] } })
  hq.send.mockResolvedValue({ data: {} })
  hq.cancel.mockResolvedValue({ data: {} })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

/** ① 配信名 → ② 関東の2店を選ぶ → ③ 本文 → ⑤ 最終確認まで進める。 */
async function fillToConfirm(body = '{店名}より：1月の限定メニュー') {
  fireEvent.change(screen.getByLabelText('配信名'), { target: { value: '1月の限定メニュー' } })
  fireEvent.click(screen.getByRole('button', { name: '対象設定へ' }))
  fireEvent.click(await screen.findByRole('checkbox', { name: /銀座店/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /新宿店/ }))
  expect(screen.getByText('12,000人')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'メッセージ設定へ' }))
  fireEvent.change(screen.getByLabelText('本文'), { target: { value: body } })
  fireEvent.click(screen.getByRole('button', { name: '送信設定へ' }))
  fireEvent.click(screen.getByRole('button', { name: '配信前チェックへ' }))
}

describe('一括配信を作る（BBRDb：店の一斉配信と同じ5段＋送るアカウント）', () => {
  it('送るアカウントを選び、最終確認で確かめると問題のある店を外し、送ると版を付けて送る', async () => {
    render(<HqBroadcastCreate />)
    await fillToConfirm()
    await screen.findByText('送る：1アカウント・6,120人')
    const input = hq.create.mock.calls[0][0]
    expect(input.accountIds).toEqual(['a1', 'a2'])
    expect(input.accountTagIds).toEqual([])
    expect(input.title).toBe('1月の限定メニュー')
    expect(input.messageContent).toBe('{{account.name}}より：1月の限定メニュー')
    expect(input.audience).toEqual({ kind: 'all' })
    expect(input.requestId).toBeTruthy()
    /* 送信枠の足りない新宿店は外す（口は外した店を送らない）。版は作ったときの 1。 */
    expect(hq.exclude).toHaveBeenCalledWith('run-1', ['a2'], 1)
    /* 保存した下書きは URL に id を残す（読み直しても同じ下書き）。 */
    expect(new URLSearchParams(window.location.search).get('id')).toBe('run-1')
    /*
     * 段の切り替え・id の書き込みはルーターを通さない（2026-10-08 オーナー：「次へ」で
     * 「このサイトを離れますか？」）。ルーターを通すと RSC を取りに行き、新しい版の後は
     * 画面を丸ごと読み直す。履歴だけを書き換える。
     */
    expect(window.location.pathname).toBe('/hq/broadcasts/new')
    expect(new URLSearchParams(window.location.search).get('step')).toBe('confirm')
    expect(replace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'この内容で予約する' }))
    fireEvent.click(await screen.findByRole('button', { name: '予約する' }))
    await waitFor(() => expect(hq.send).toHaveBeenCalledWith('run-1', 2))
    expect(push).toHaveBeenCalledWith('/hq/broadcasts/detail?id=run-1')
  })

  it('手順の済みの段（✓）を押すと、その段へ戻る（今とまだの段は押せない）', async () => {
    render(<HqBroadcastCreate />)
    fireEvent.change(screen.getByLabelText('配信名'), { target: { value: '1月の限定メニュー' } })
    fireEvent.click(screen.getByRole('button', { name: '対象設定へ' }))
    await screen.findByRole('checkbox', { name: /銀座店/ })
    const steps = screen.getByRole('navigation', { name: '配信作成の進み' })
    /* 今の段（配信対象）とまだの段は押せない。 */
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain('配信対象')
    expect(screen.queryByRole('button', { name: '配信対象に戻る' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'メッセージを作成に戻る' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '基本設定に戻る' }))
    /* 基本設定の段が出る（配信名の欄・URL も書き換え）。 */
    expect((await screen.findByLabelText('配信名') as HTMLInputElement).value).toBe('1月の限定メニュー')
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toContain('基本設定')
    /* URL の段は履歴だけを書き換える（ルーターを通さない・#1630 と同じ決まり）。 */
    expect(new URLSearchParams(window.location.search).get('step')).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })

  it('API-18：フォルダ・社内メモ・シナリオ購読中・除くタグ・2つの吹き出しを口へ送る', async () => {
    hq.folders.mockResolvedValue({ success: true, data: [{ id: 'bf-1', name: 'キャンペーン', revision: 1, item_count: 0 }] })
    render(<HqBroadcastCreate />)
    fireEvent.change(screen.getByLabelText('配信名'), { target: { value: '1月の限定メニュー' } })
    await waitFor(() => expect(hq.folders).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('社内メモ'), { target: { value: '関東だけ' } })
    fireEvent.click(screen.getByRole('button', { name: '対象設定へ' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /銀座店/ }))
    fireEvent.click(screen.getByRole('radio', { name: /シナリオ購読中の全員に配信する/ }))
    fireEvent.click(screen.getByRole('button', { name: 'メッセージ設定へ' }))
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '1通目' } })
    fireEvent.click(screen.getByRole('button', { name: /メッセージを追加する/ }))
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '2通目' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(hq.create).toHaveBeenCalled())
    const input = hq.create.mock.calls[0][0]
    expect(input.internalMemo).toBe('関東だけ')
    expect(input.targetType).toBe('segment')
    expect(input.segmentConditions).toEqual({ operator: 'AND', rules: [{ type: 'scenario_subscribed', value: '' }] })
    const bubbles = JSON.parse(input.messageBubblesJson)
    expect(bubbles.map((b: { content: { text: string } }) => b.content.text)).toEqual(['1通目', '2通目'])
  })

  it('API-18：承認が要るときは送らず［承認を依頼する］（別の担当者を選んで頼む）', async () => {
    hq.approval.mockResolvedValue({ success: true, data: { approval: { status: 'none', requestedByStaffId: null, requestedAt: null, approverStaffId: null, note: null, decidedByStaffId: null, decidedAt: null, rejectReason: null, confirmedCount: null }, gate: { required: true, recipientCount: 6120, threshold: 1000, singleOperator: false, operatorCount: 2 }, viewer: { isApprover: false, canApprove: false, isRequester: false } } })
    hq.approvalCandidates.mockResolvedValue({ success: true, data: [{ id: 's-2', name: '佐々木', role: 'admin', canApprove: true }] })
    render(<HqBroadcastCreate />)
    await fillToConfirm()
    await screen.findByText('送る：1アカウント・6,120人')
    fireEvent.click(await screen.findByRole('button', { name: '承認を依頼する' }))
    expect(await screen.findByText(/もう1人の承認が要ります/)).toBeTruthy()
    expect(await screen.findByText('承認をお願いする人')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '予約する' })).toBeNull()
    expect(hq.send).not.toHaveBeenCalled()
  })

  it('入れていない所があると口を呼ばず、その欄のある段へ移るボタンを出す', async () => {
    render(<HqBroadcastCreate />)
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    expect((await screen.findByRole('alert')).textContent).toContain('配信名を入れてください')
    fireEvent.change(screen.getByLabelText('配信名'), { target: { value: '告知' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    expect((await screen.findByRole('alert')).textContent).toContain('送るアカウントを選んでください')
    fireEvent.click(screen.getByRole('button', { name: '配信対象へ移動' }))
    expect(await screen.findByRole('heading', { name: '送るアカウント' })).toBeTruthy()
    expect(hq.create).not.toHaveBeenCalled()
  })

  it('本文を変えたら、もう一度確かめるまで送らない（同じ下書きを版つきで直す。取り消して作り直さない）', async () => {
    render(<HqBroadcastCreate />)
    await fillToConfirm('はじめの本文')
    await screen.findByText('送る：1アカウント・6,120人')
    fireEvent.click(screen.getByRole('button', { name: 'メッセージへ戻る' }))
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '直した本文' } })
    fireEvent.click(screen.getByRole('button', { name: '送信設定へ' }))
    fireEvent.click(screen.getByRole('button', { name: '配信前チェックへ' }))
    await waitFor(() => expect(hq.update).toHaveBeenCalledTimes(1))
    expect(hq.create).toHaveBeenCalledTimes(1)
    expect(hq.cancel).not.toHaveBeenCalled()
    const [id, body] = hq.update.mock.calls[0]
    expect(id).toBe('run-1')
    expect(body).toMatchObject({ messageContent: '直した本文', expectedVersion: 2, requestId: hq.create.mock.calls[0][0].requestId })
  })

  it('WEB011：作れたあと確かめが失敗したら、やり直しは同じ下書きを直す（もう1つ作らない・409 にしない）', async () => {
    hq.preflight.mockRejectedValueOnce(new Error('network'))
    render(<HqBroadcastCreate />)
    await fillToConfirm()
    await waitFor(() => expect(hq.create).toHaveBeenCalledTimes(1))
    const again = await screen.findByRole('button', { name: '送る前に確かめる' })
    fireEvent.click(again)
    await screen.findByText('送る：1アカウント・6,120人')
    expect(hq.create).toHaveBeenCalledTimes(1)
    expect(hq.update).toHaveBeenCalledWith('run-1', expect.objectContaining({ expectedVersion: 1, requestId: hq.create.mock.calls[0][0].requestId }))
  })

  it('?id= の下書きを読み、配信名・本文・送るアカウント（タグで作った下書きはそのタグのアカウント）・時刻を戻して、同じ下書きを直す', async () => {
    params.value = new URLSearchParams('id=run-7&step=confirm')
    hq.get.mockResolvedValue({ data: {
      id: 'run-7', title: '1月の限定メニュー', status: 'prepared', version: 3, scheduledAt: null, targets: [],
      input: { requestId: 'req-7', title: '1月', messageType: 'text', messageContent: '{{ account.name }}より：電話 {{var.store_phone}}', accountIds: [], accountTagIds: ['t2'], excludedAccountIds: [], audience: { kind: 'all' }, scheduledAt: null },
    } })
    render(<HqBroadcastCreate />)
    await waitFor(() => expect(screen.getByText('梅田店（1）', { exact: false })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '送る前に確かめる' }))
    await waitFor(() => expect(hq.update).toHaveBeenCalledWith('run-7', expect.objectContaining({ requestId: 'req-7', expectedVersion: 3, title: '1月', accountIds: ['a3'], accountTagIds: [], scheduledAt: null, messageContent: '{{account.name}}より：電話 {{var.store_phone}}' })))
    expect(hq.create).not.toHaveBeenCalled()
  })

  it('タグで絞ると、選んだアカウントのタグの名前から選び、口へは同じ名前のタグで送る', async () => {
    render(<HqBroadcastCreate />)
    fireEvent.change(screen.getByLabelText('配信名'), { target: { value: 'VIP だけ' } })
    fireEvent.click(screen.getByRole('button', { name: '対象設定へ' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /銀座店/ }))
    fireEvent.click(screen.getByRole('radio', { name: /タグで絞り込んで配信する/ }))
    await waitFor(() => expect(tagList).toHaveBeenCalledWith({ accountId: 'a1' }))
    const box = screen.getByRole('combobox', { name: '含めるタグ' })
    await waitFor(() => expect((box as HTMLInputElement).disabled).toBe(false))
    fireEvent.focus(box)
    fireEvent.click(await screen.findByRole('option', { name: /VIP/ }))
    fireEvent.click(screen.getByRole('button', { name: 'メッセージ設定へ' }))
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: 'ご案内' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(hq.create).toHaveBeenCalled())
    expect(hq.create.mock.calls[0][0].audience).toEqual({ kind: 'tag', tagName: 'VIP' })
  })

  it('クーポンは統括の共有素材（どの店にも属さない）から選び、店側と同じ吹き出しで送る', async () => {
    render(<HqBroadcastCreate />)
    fireEvent.change(screen.getByLabelText('配信名'), { target: { value: '冬のクーポン' } })
    fireEvent.click(screen.getByRole('button', { name: '対象設定へ' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /銀座店/ }))
    fireEvent.click(screen.getByRole('button', { name: 'メッセージ設定へ' }))
    /* 絵 lLyFR の「その他」がクーポン（統括だけの種類）。 */
    fireEvent.click(screen.getByRole('tab', { name: 'その他' }))
    fireEvent.click(await screen.findByRole('button', { name: 'クーポンを選ぶ' }))
    /* 店に属する素材（銀座店だけ）は出さない。 */
    expect(screen.queryByRole('option', { name: '銀座店だけ' })).toBeNull()
    fireEvent.click(within(await screen.findByRole('option', { name: '冬の10%オフ' })).getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(hq.create).toHaveBeenCalled())
    const input = hq.create.mock.calls[0][0]
    expect(JSON.parse(input.messageBubblesJson)).toEqual([expect.objectContaining({ type: 'coupon', content: expect.objectContaining({ assetId: 'as-1', assetName: '冬の10%オフ' }) })])
    expect(input.messageType).not.toBe('text')
  })

  /** ① 配信名 → ② 銀座店 → ③ を開いたところまで。 */
  async function toMessage(name = '秋の新商品') {
    fireEvent.change(screen.getByLabelText('配信名'), { target: { value: name } })
    fireEvent.click(screen.getByRole('button', { name: '対象設定へ' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /銀座店/ }))
    fireEvent.click(screen.getByRole('button', { name: 'メッセージ設定へ' }))
  }
  const carouselDetail = (id: string, columns: unknown[]) => ({
    template: { id, name: '秋の新商品 3種', template_type: 'template', description: null, revision: 1, updated_at: '' },
    definition: { schemaVersion: 1, media: [], template: { id, name: '秋の新商品 3種', category: '', messageType: 'carousel', messageContent: JSON.stringify(columns), carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' } },
  })

  it('③ の種類のタブは絵 lLyFR の並び（テキスト〜紹介・その他）で、見出しの右に［テンプレートから選ぶ］', async () => {
    render(<HqBroadcastCreate />)
    await toMessage()
    const tabs = within(screen.getByRole('tablist', { name: 'メッセージの形式' })).getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['テキスト', '画像', '動画', '音声', 'スタンプ', 'カルーセル', 'リッチメッセージ', '位置情報', '質問', '紹介', 'その他'])
    expect(screen.getByRole('button', { name: 'テンプレートから選ぶ' })).toBeTruthy()
  })

  it('画像はどの店にも属さない置き場へ上げ、店の一斉配信と同じ吹き出し（image）で送る', async () => {
    upload.mockResolvedValue({ success: true, data: { key: 'k', url: 'https://cdn.example/a.png', mimeType: 'image/png', size: 10 } })
    render(<HqBroadcastCreate />)
    await toMessage()
    fireEvent.click(screen.getByRole('tab', { name: '画像' }))
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file, null))
    await screen.findByText(/アップロード済み/)
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(hq.create).toHaveBeenCalled())
    const input = hq.create.mock.calls[0][0]
    expect(input.messageType).toBe('image')
    expect(JSON.parse(input.messageBubblesJson)).toEqual([expect.objectContaining({ type: 'image', content: { originalContentUrl: 'https://cdn.example/a.png', previewImageUrl: 'https://cdn.example/a.png' } })])
  })

  it('スタンプは店と同じ一覧から選び、sticker の吹き出しで送る', async () => {
    render(<HqBroadcastCreate />)
    await toMessage()
    fireEvent.click(screen.getByRole('tab', { name: 'スタンプ' }))
    fireEvent.click(screen.getByTitle('ありがとう'))
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(hq.create).toHaveBeenCalled())
    const input = hq.create.mock.calls[0][0]
    expect(input.messageType).toBe('sticker')
    expect(JSON.parse(input.messageContent)).toEqual({ packageId: '446', stickerId: '1990' })
    expect(JSON.parse(input.messageBubblesJson)[0].type).toBe('sticker')
  })

  it('カルーセルは統括のカルーセルのひな形から選び、カードの中身を控えて carousel の吹き出しで送る', async () => {
    const columns = [{ title: '秋の新商品 3種', text: '定期便なら10%オフ', actions: [{ type: 'uri', label: '商品を見る', uri: 'https://shop.example/a' }] }]
    tpl.listByKind.mockImplementation(async (kind?: string) => (kind === 'carousel' ? [{ id: 'ct-1', name: '秋の新商品 3種', kind: 'carousel' }] : []))
    tpl.get.mockResolvedValue(carouselDetail('ct-1', columns))
    render(<HqBroadcastCreate />)
    await toMessage()
    fireEvent.click(screen.getByRole('tab', { name: 'カルーセル' }))
    await waitFor(() => expect(tpl.listByKind).toHaveBeenCalledWith('carousel'))
    fireEvent.click(await screen.findByRole('button', { name: 'カルーセルを選ぶ' }))
    fireEvent.click(within(await screen.findByRole('option', { name: '秋の新商品 3種' })).getByRole('button'))
    await screen.findByText('カード1枚')
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(hq.create).toHaveBeenCalled())
    const input = hq.create.mock.calls[0][0]
    expect(input.messageType).toBe('carousel')
    expect(JSON.parse(input.messageContent)).toEqual(columns)
    expect(JSON.parse(input.messageBubblesJson)).toEqual([expect.objectContaining({ type: 'carousel', content: expect.objectContaining({ hqTemplateId: 'ct-1', columnsJson: JSON.stringify(columns) }) })])
  })

  it('ボタンで動きを実行する（postback）カルーセルは、店で押しても動かないので保存しない', async () => {
    tpl.listByKind.mockImplementation(async (kind?: string) => (kind === 'carousel' ? [{ id: 'ct-2', name: '秋の新商品 3種', kind: 'carousel' }] : []))
    tpl.get.mockResolvedValue(carouselDetail('ct-2', [{ text: 'a', actions: [{ type: 'postback', label: '申し込む', data: 'ctpl=hq&c=0&a=0' }] }]))
    render(<HqBroadcastCreate />)
    await toMessage()
    fireEvent.click(screen.getByRole('tab', { name: 'カルーセル' }))
    fireEvent.click(await screen.findByRole('button', { name: 'カルーセルを選ぶ' }))
    fireEvent.click(within(await screen.findByRole('option', { name: '秋の新商品 3種' })).getByRole('button'))
    await screen.findByText('カード1枚')
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    expect((await screen.findAllByRole('alert')).map((el) => el.textContent).join('')).toContain('ボタンで動きを実行するカルーセルは、まだ統括からは送れません')
    expect(hq.create).not.toHaveBeenCalled()
  })

  it('質問・紹介はタブを出すが「まだ統括からは送れません」の1行だけで、保存しない', async () => {
    render(<HqBroadcastCreate />)
    await toMessage()
    fireEvent.click(screen.getByRole('tab', { name: '質問' }))
    expect(screen.getByRole('note').textContent).toBe('質問は、まだ統括からは送れません。送るときは店の一斉配信で作ってください')
    expect(screen.queryByLabelText('本文')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    expect((await screen.findByRole('alert')).textContent).toContain('質問は、まだ統括からは送れません。送るときは店の一斉配信で作ってください')
    expect(hq.create).not.toHaveBeenCalled()
  })

  it('［テンプレートから選ぶ］で統括のひな形を選ぶと、開いている吹き出しをその内容にする', async () => {
    tpl.listByKind.mockImplementation(async () => [{ id: 'mt-1', name: '定休日のお知らせ', kind: 'message', content_summary: 'テキスト' }])
    tpl.get.mockResolvedValue({
      template: { id: 'mt-1', name: '定休日のお知らせ', template_type: 'template', description: null, revision: 1, updated_at: '' },
      definition: { schemaVersion: 1, media: [], template: { id: 'mt-1', name: '定休日のお知らせ', category: '', messageType: 'text', messageContent: '{{account.name}}は明日お休みです', carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' } },
    })
    render(<HqBroadcastCreate />)
    await toMessage()
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートから選ぶ' }))
    fireEvent.click(await screen.findByRole('button', { name: /定休日のお知らせ/ }))
    await waitFor(() => expect((screen.getByLabelText('本文') as HTMLTextAreaElement).value).toBe('{店名}は明日お休みです'))
  })

  it('① テンプレートを選択：窓で仮選択し、使う操作で1行と③の中身・右の見え方に反映する（EpTBB）', async () => {
    tpl.listByKind.mockImplementation(async () => [{ id: 'mt-1', name: '予約前日のご案内', kind: 'message', content_summary: 'テキスト', updated_at: '2026-09-28T00:00:00Z' }])
    tpl.get.mockResolvedValue({
      template: { id: 'mt-1', name: '予約前日のご案内', template_type: 'template', description: null, revision: 1, updated_at: '' },
      definition: { schemaVersion: 1, media: [], template: { id: 'mt-1', name: '予約前日のご案内', category: '', messageType: 'text', messageContent: '明日のご予約をお待ちしています', carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' } },
    })
    render(<HqBroadcastCreate />)
    /* 右の列はどの段でもいつも出す（店の一斉配信と同じ頭とスマホ・PC）。 */
    const aside = screen.getByRole('complementary', { name: 'LINEの見え方' })
    expect(within(aside).getByRole('heading', { name: 'LINE の見え方' })).toBeTruthy()
    expect(within(aside).getByRole('button', { name: 'PC' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /テンプレートを選択/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートを選ぶ' }))
    fireEvent.click(await screen.findByRole('radio', { name: '予約前日のご案内' }))
    expect((screen.getByLabelText('配信名') as HTMLInputElement).value).toBe('')
    expect(within(aside).queryByText('明日のご予約をお待ちしています')).toBeNull()
    await waitFor(() => expect((screen.getByRole('button', { name: 'このテンプレートを使う' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'このテンプレートを使う' }))
    await waitFor(() => expect(within(aside).getByText('明日のご予約をお待ちしています')).toBeTruthy())
    expect((screen.getByLabelText('配信名') as HTMLInputElement).value).toBe('予約前日のご案内')
    expect(screen.getByRole('button', { name: '選び直す' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '対象設定へ' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /銀座店/ }))
    fireEvent.click(screen.getByRole('button', { name: 'メッセージ設定へ' }))
    expect((screen.getByLabelText('本文') as HTMLTextAreaElement).value).toBe('明日のご予約をお待ちしています')
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(hq.create).toHaveBeenCalled())
    expect(hq.create.mock.calls[0][0].messageContent).toBe('明日のご予約をお待ちしています')
  })

  it('① 過去の配信を複製：選ぶと配信名に（コピー）を付けて中身を写し、宛先と日時は写さない', async () => {
    hq.list.mockResolvedValue({ data: [{ id: 'run-s', title: '9月キャンペーンのお知らせ', status: 'sent', version: 3, scheduledAt: '2026-09-20T01:00:00Z', targets: [{ ...check('a1', '銀座店', 1284), status: 'sent', totalCount: 1284, successCount: 1284, version: 1, retryableCount: 0, stopped: false, failureReasons: [] }],
      input: { requestId: 'r', title: '9月キャンペーンのお知らせ', messageType: 'text', messageContent: '9月のご案内です', accountIds: ['a1'], accountTagIds: [], excludedAccountIds: [], audience: { kind: 'tag', tagName: 'VIP' }, scheduledAt: '2026-09-20T01:00:00Z' } }] })
    render(<HqBroadcastCreate />)
    fireEvent.click(screen.getByRole('radio', { name: /過去の配信を複製/ }))
    hq.get.mockResolvedValue({ data: (await hq.list()).data[0] })
    fireEvent.click(screen.getByRole('button', { name: '過去の配信を選ぶ' }))
    fireEvent.click(await screen.findByRole('radio', { name: '9月キャンペーンのお知らせ' }))
    expect((screen.getByLabelText('配信名') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'この配信を写す' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((screen.getByLabelText('配信名') as HTMLInputElement).value).toBe('9月キャンペーンのお知らせ（コピー）')
    expect(within(screen.getByRole('complementary', { name: 'LINEの見え方' })).getByText('9月のご案内です')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '対象設定へ' }))
    expect(((await screen.findByRole('checkbox', { name: /銀座店/ })) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('radio', { name: /友だち全員に配信する/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('③ カルーセルをその場で作る：店のカルーセルの作る部品で作った中身が吹き出しに入り、carousel で送る', async () => {
    render(<HqBroadcastCreate />)
    await toMessage()
    fireEvent.click(screen.getByRole('tab', { name: 'カルーセル' }))
    fireEvent.click(screen.getByRole('button', { name: /カルーセルをその場で作る/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'メッセージに入れる' }))
    expect(await screen.findByText('カード2枚')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(hq.create).toHaveBeenCalled())
    const input = hq.create.mock.calls[0][0]
    expect(input.messageType).toBe('carousel')
    expect(JSON.parse(input.messageBubblesJson)[0]).toMatchObject({ type: 'carousel', content: { templateName: 'その場のカルーセル' } })
  })

  it('③ リッチメッセージをその場で作る：店のリッチメッセージの作る部品で作った中身を rich_message の吹き出しで送る', async () => {
    render(<HqBroadcastCreate />)
    await toMessage()
    fireEvent.click(screen.getByRole('tab', { name: 'リッチメッセージ' }))
    fireEvent.click(screen.getByRole('button', { name: /リッチメッセージをその場で作る/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'メッセージに入れる' }))
    await screen.findByText(/その場で作ったリッチメッセージ：その場のリッチ/)
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(hq.create).toHaveBeenCalled())
    const bubble = JSON.parse(hq.create.mock.calls[0][0].messageBubblesJson)[0]
    expect(bubble.type).toBe('rich_message')
    expect(bubble.content).toMatchObject({ assetName: 'その場のリッチ', imageUrl: 'https://cdn.example/rich.png' })
    expect(bubble.content.media).toBeUndefined()
  })

  it('［保存してテンプレート化する］：テキストは統括のひな形に保存し、まだ保存できない種類は口を呼ばず理由を出す', async () => {
    tpl.create.mockResolvedValue({ template: { id: 'new' }, definition: {} })
    render(<HqBroadcastCreate />)
    await toMessage('定休日')
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '{店名}は明日お休みです' } })
    fireEvent.click(screen.getByRole('button', { name: /保存してテンプレート化する/ }))
    fireEvent.click(await screen.findByRole('button', { name: '保存する' }))
    await waitFor(() => expect(tpl.create).toHaveBeenCalledTimes(1))
    const [body] = tpl.create.mock.calls[0]
    expect(body).toMatchObject({ type: 'template', name: '定休日', definition: { template: { messageType: 'text', messageContent: '{{account.name}}は明日お休みです' } } })
    fireEvent.click(screen.getByRole('tab', { name: 'スタンプ' }))
    fireEvent.click(screen.getByTitle('ありがとう'))
    fireEvent.click(screen.getByRole('button', { name: /保存してテンプレート化する/ }))
    fireEvent.click(await screen.findByRole('button', { name: '保存する' }))
    expect(await screen.findByText('スタンプは、まだ統括のテンプレートとして保存できません')).toBeTruthy()
    expect(tpl.create).toHaveBeenCalledTimes(1)
  })

  it('画像・ボタンつきのメッセージのひな形（カード）は flex のまま送り、回答フォーム・シナリオのボタン（postback）があれば保存しない', async () => {
    const flex = (action: unknown) => JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '秋の新商品' }] }, footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action }] } })
    tpl.listByKind.mockImplementation(async () => [{ id: 'mt-9', name: '秋の新商品のお知らせ', kind: 'message', content_summary: '本文・画像 1' }])
    const detail = (content: string) => ({ template: { id: 'mt-9', name: '秋の新商品のお知らせ', template_type: 'template', description: null, revision: 1, updated_at: '' },
      definition: { schemaVersion: 1, media: [], template: { id: 'mt-9', name: '秋の新商品のお知らせ', category: '', messageType: 'flex', messageContent: content, carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' } } })
    tpl.get.mockResolvedValue(detail(flex({ type: 'uri', label: '見る', uri: 'https://shop.example/' })))
    render(<HqBroadcastCreate />)
    await toMessage()
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートから選ぶ' }))
    fireEvent.click(await screen.findByRole('button', { name: /秋の新商品のお知らせ/ }))
    expect(await screen.findByText(/のカードをそのまま送ります/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    await waitFor(() => expect(hq.create).toHaveBeenCalled())
    expect(hq.create.mock.calls[0][0].messageType).toBe('flex')
    cleanup(); hq.create.mockClear()
    tpl.get.mockResolvedValue(detail(flex({ type: 'postback', label: '申し込む', data: 'form=1' })))
    render(<HqBroadcastCreate />)
    await toMessage()
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートから選ぶ' }))
    fireEvent.click(await screen.findByRole('button', { name: /秋の新商品のお知らせ/ }))
    await screen.findByText(/のカードをそのまま送ります/)
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存する' }))
    expect((await screen.findAllByRole('alert')).map((el) => el.textContent).join('')).toContain('回答フォーム・シナリオを開くボタンのあるカードは、まだ統括からは送れません')
    expect(hq.create).not.toHaveBeenCalled()
  })

  it('閲覧のみ（担当者）には作る画面を出さない', async () => {
    role.value = 'staff'
    render(<HqBroadcastCreate />)
    expect(screen.getByText(/統括全体の編集権限がある人/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /下書きを保存する|予約する|今すぐ送る/ })).toBeNull()
  })
})

describe('一括配信の詳細（xOXuY ⑤ 送った結果）', () => {
  it('店ごとの結果を出し、失敗した店にやり直す（店の配信の版を付ける）', async () => {
    params.value = new URLSearchParams('id=run-9')
    hq.get.mockResolvedValue({ data: {
      id: 'run-9', title: '1月の限定メニュー', status: 'scheduled', version: 4, scheduledAt: '2026-01-15T02:00:00.000Z',
      targets: [
        { ...check('a1', '銀座店', 6120), status: 'sent', totalCount: 6120, successCount: 6118, version: 3, retryableCount: 0, stopped: false, broadcastId: 'b1' },
        { ...check('a3', '名古屋店', 460), status: 'failed', totalCount: 460, successCount: 0, version: 5, retryableCount: 460, stopped: false, broadcastId: 'b3' },
      ],
    } })
    hq.retry.mockResolvedValue({ data: {} })
    render(<HqBroadcastDetail />)
    await screen.findByText('アカウントごとの送った結果')
    expect(screen.getByText('送れた')).toBeTruthy()
    /* 表の中（店ごと）：見出しの「失敗」と名古屋店の札の2つ。上の数の帯の「失敗」は数えない。 */
    expect(within(document.querySelector('[data-design="hq-broadcast-result"]') as HTMLElement).getAllByText('失敗')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /失敗した店にやり直す/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'やり直す' }))
    await waitFor(() => expect(hq.retry).toHaveBeenCalledWith('run-9', 'a3', 5))
    expect(hq.retry).toHaveBeenCalledTimes(1)
  })

  it('店ごとの失敗の理由（口の failureReasons）を表の下に出す。下書きには［下書きを直す］', async () => {
    params.value = new URLSearchParams('id=run-9')
    hq.get.mockResolvedValue({ data: {
      id: 'run-9', title: '1月の限定メニュー', status: 'scheduled', version: 4, scheduledAt: '2026-01-15T02:00:00.000Z',
      targets: [
        { ...check('a3', '名古屋店', 460), status: 'failed', totalCount: 460, successCount: 0, version: 5, retryableCount: 460, stopped: false, broadcastId: 'b3',
          failureReasons: [{ code: 'line_busy', label: 'LINEが混雑しています', count: 460, retryable: true }] },
      ],
    } })
    render(<HqBroadcastDetail />)
    const reasons = await waitFor(() => { const el = document.querySelector('[data-failure-reasons]'); if (!el) throw new Error('まだ'); return el as HTMLElement })
    expect(reasons.textContent).toContain('名古屋店')
    expect(reasons.textContent).toContain('LINEが混雑しています（460人）・やり直せます')
    cleanup()
    hq.get.mockResolvedValue({ data: { id: 'run-9', title: '下書き', status: 'prepared', version: 1, scheduledAt: null, targets: [], input: { messageContent: '' } } })
    render(<HqBroadcastDetail />)
    expect((await screen.findByRole('link', { name: /下書きを直す/ })).getAttribute('href')).toBe('/hq/broadcasts/new?id=run-9')
  })
})
