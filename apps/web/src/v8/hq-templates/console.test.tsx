// @vitest-environment happy-dom
/*
 * 統括のテンプレート（B-29・B-36）：作るは店のテンプレートの作る画面（メッセージ HfK0O・クーポン C3qMCz）を使い、
 * 下の帯の主ボタンは［保存して配る］。保存は統括の口（ひな形）へ、配るは「アカウントへ配る」へ進む。
 * 詳細（pQ4fH）は「配った先」（API-14 の配った先のアカウント名）と［アカウントへ配る］。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => Object.fromEntries(['context', 'list', 'listByKind', 'kindCounts', 'accounts', 'get', 'create', 'update', 'remove', 'duplicate', 'preflight', 'distribute', 'result', 'messageReferences', 'folderList', 'deleteImage', 'uploadRichMessageImage', 'uploadImage', 'listStats', 'versions', 'receivedVersions', 'compareVersions', 'restoreVersion'].map((key) => [key, vi.fn()])))
const push = vi.hoisted(() => vi.fn())
const selectAccount = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hq-templates-api', () => ({ TEMPLATE_TYPES: ['tag', 'template', 'rich_menu', 'form', 'scenario'], hqTemplatesApi: { ...calls, folders: { list: calls.folderList } } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq/templates',
}))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ accounts: [], selectedAccountId: null, selectedAccount: null, setSelectedAccountId: selectAccount, loading: false }) }))
const chrome = vi.hoisted(() => ({ crumbs: null as Array<{ label: string; href?: string; onSelect?: () => void }> | null }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: (crumbs: typeof chrome.crumbs) => { chrome.crumbs = crumbs } }))
vi.mock('@/components/auto-replies/inline-action-list', () => ({ useActionOptions: () => ({ tags: [], scenarios: [], templates: [], forms: [], reminders: [], richMenus: [] }) }))

import HqTemplatesV8 from './console'

const message = {
  schemaVersion: 1,
  template: { id: 'hq-authored-message', name: '予約前日のご案内', category: 'general', messageType: 'text', messageContent: '{{name}}さん、明日のご予約です', carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' },
  media: [],
}
const detail = (definition: unknown = message) => ({ template: { id: 't-1', name: '予約前日のご案内', description: '', template_type: 'template', folder_id: null, revision: 3, updated_at: '2026-08-21T09:02:00Z' }, definition })
const listRow = { ...detail().template, kind: 'message', content_summary: '本文', distributed_account_count: 4, distributed_account_names: ['然 -NEN- 本店', '然 -NEN- 渋谷店', '2025年イベント'], distributed_account_more: 1 }

beforeEach(() => {
  window.sessionStorage.clear()
  calls.context.mockResolvedValue({ tenantId: 'tenant-a', actorId: 'owner' })
  calls.list.mockResolvedValue([listRow])
  calls.listByKind.mockResolvedValue([listRow])
  calls.kindCounts.mockResolvedValue({ message: 1, carousel: 0, rich_message: 0, question: 0, coupon: 0, research: 0 })
  calls.accounts.mockResolvedValue([{ id: 'a-1', name: '然 -NEN- 本店' }, { id: 'a-2', name: '然 -NEN- 渋谷店' }])
  calls.folderList.mockResolvedValue([{ id: 'f-1', name: '予約', revision: 1 }])
  calls.messageReferences.mockResolvedValue([])
  calls.listStats.mockResolvedValue({ thisMonthSentCount: 0, outdatedTemplateCount: 0 })
  calls.versions.mockResolvedValue([])
  calls.receivedVersions.mockResolvedValue([])
  calls.get.mockResolvedValue(detail())
  calls.create.mockImplementation(async (input: { name: string; definition: unknown }) => ({ template: { ...detail().template, id: 't-new', name: input.name }, definition: input.definition }))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('統括のテンプレートを作る（店の作る画面＋保存して配る）', () => {
  it('作る画面から一覧へは、上の帯のパンくず「テンプレート」で戻る（同じ URL のまま段を替える）', async () => {
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click((await screen.findAllByRole('button', { name: /テンプレートを作る/ }))[0])
    expect(await screen.findByText('保存して配ると、選んだアカウントのテンプレートに新しい版として届きます')).toBeTruthy()
    const crumb = chrome.crumbs?.find((item) => item.label === 'テンプレート')
    expect(crumb?.href).toBe('/hq/templates')
    expect(crumb?.onSelect).toBeTypeOf('function')
    act(() => { crumb!.onSelect!() })
    await waitFor(() => expect(screen.queryByText('保存して配ると、選んだアカウントのテンプレートに新しい版として届きます')).toBeNull())
    expect((await screen.findAllByRole('button', { name: /テンプレートを作る/ })).length).toBeGreaterThan(0)
    // 一覧の段では、パンくずは「ホーム」だけ
    expect(chrome.crumbs?.some((item) => item.onSelect)).toBe(false)
  })
  it('作る画面から一覧へは、下の帯の［キャンセル］でも戻る', async () => {
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click((await screen.findAllByRole('button', { name: /テンプレートを作る/ }))[0])
    expect(await screen.findByText('保存して配ると、選んだアカウントのテンプレートに新しい版として届きます')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByText('保存して配ると、選んだアカウントのテンプレートに新しい版として届きます')).toBeNull())
    expect((await screen.findAllByRole('button', { name: /テンプレートを作る/ })).length).toBeGreaterThan(0)
  })
  it('メッセージは店の作る画面で作り、［保存して配る］で統括のひな形を作ってアカウントへ配るへ進む', async () => {
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click((await screen.findAllByRole('button', { name: /テンプレートを作る/ }))[0])
    expect(await screen.findByText('保存して配ると、選んだアカウントのテンプレートに新しい版として届きます')).toBeTruthy()
    // 板の頭の「← テンプレートへ」は無くした（2026-10-08）。一覧へは上の帯のパンくずで戻る。
    expect(screen.queryByText('← テンプレートへ')).toBeNull()
    expect(screen.queryByText('形')).toBeNull()
    expect(screen.queryByText(/この形は新しく作れません/)).toBeNull()
    fireEvent.change(screen.getByLabelText('テンプレート名'), { target: { value: '予約前日' } })
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '{{name}}さん、明日です' } })
    fireEvent.click(screen.getByRole('button', { name: '保存して配る' }))
    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    const [input, requestId] = calls.create.mock.calls[0]
    expect(requestId).toBeTruthy()
    expect(input).toMatchObject({ type: 'template', name: '予約前日', folderId: null })
    expect(input.definition.template).toMatchObject({ name: '予約前日', messageType: 'text', messageContent: '{{name}}さん、明日です' })
    /* 保存のあとは「アカウントへ配る」（meBRB）。 */
    expect(await screen.findByRole('checkbox', { name: /然 -NEN- 本店/ })).toBeTruthy()
  })

  it.each([
    ['flex', JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '元の本文' }] } }), JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '直した本文' }] } })],
    ['image', 'https://img.example/old.png', 'https://img.example/new.png'],
  ])('統括の既存%sも帯を出して元の形のまま保存できる', async (messageType, messageContent, next) => {
    calls.get.mockResolvedValue(detail({ ...message, template: { ...message.template, messageType, messageContent } }))
    calls.update.mockImplementation(async (_id: string, input: { definition: unknown }) => detail(input.definition))
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click(await screen.findByRole('button', { name: '予約前日のご案内' }))
    fireEvent.click(await screen.findByRole('button', { name: '編集する' }))
    expect(await screen.findByText('この形は新しく作れません。新しく作るときはカルーセル・リッチメッセージを使ってください。')).toBeTruthy()
    expect(screen.queryByText('形')).toBeNull()
    fireEvent.change(screen.getByLabelText('メッセージ内容'), { target: { value: next } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(calls.update).toHaveBeenCalled())
    expect(calls.update.mock.calls[0][1].definition.template).toMatchObject({ messageType, messageContent: next })
  })

  it('クーポンは店のクーポンを作る画面で作り、店と同じ形の payload を統括のひな形の素材にする（店のアカウントに結びつく欄は出さない）', async () => {
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click(await screen.findByRole('tab', { name: /クーポン/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: /テンプレートを作る/ }))[0])
    expect(await screen.findByRole('heading', { name: 'クーポンを作る' })).toBeTruthy()
    expect(screen.queryByText('使われたときに行うこと')).toBeNull()
    fireEvent.change(screen.getByLabelText('テンプレート名'), { target: { value: '冬の10%オフ' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    /* 期間が無いと口を呼ばない。 */
    expect((await screen.findByRole('alert')).textContent).toContain('使える期間')
    expect(calls.create).not.toHaveBeenCalled()
  })
})

describe('統括のテンプレートを作る（質問・カルーセル）', () => {
  it('質問は店の質問を作る画面で作り、質問の JSON を統括のひな形にする（押したときの動きは出さない）', async () => {
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click(await screen.findByRole('tab', { name: /質問/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: /テンプレートを作る/ }))[0])
    expect(await screen.findByRole('heading', { name: '質問を作る' })).toBeTruthy()
    expect(screen.queryByText('押されたら')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('例：継続の意思をうかがう'), { target: { value: '好みのコース' } })
    fireEvent.change(screen.getByLabelText(/^質問文/), { target: { value: 'どのコースが好きですか？' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    const definition = calls.create.mock.calls[0][0].definition
    expect(JSON.parse(definition.template.questionJson)).toMatchObject({ text: 'どのコースが好きですか？', tapMode: 'single' })
    expect(definition.asset).toBeUndefined()
  })

  it('カルーセルの画像は統括の口で受け取り、保存と後片付けの対象を正しく残す', async () => {
    const media = { id: 'image-1', kind: 'image', filename: 'card.png', mimeType: 'image/png', sizeBytes: 5, width: 1040, height: 1040, durationMs: null, r2Key: 'hq/card.png', publicUrl: 'https://img.test/card.png', versionId: 'v1', versionNo: 1, contentHash: 'hash' }
    calls.uploadImage.mockResolvedValue(media)
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click(await screen.findByRole('tab', { name: /カルーセル/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: /テンプレートを作る/ }))[0])
    await screen.findByRole('heading', { name: 'カルーセルを作る' })
    fireEvent.change(screen.getByPlaceholderText('例：夏の定番5点'), { target: { value: '写真付きのご案内' } })
    fireEvent.change(screen.getByLabelText(/本文（/), { target: { value: '画像と本文' } })
    const file = new File(['image'], 'card.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('カードの画像ファイル'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByAltText('カードの画像').getAttribute('src')).toBe(media.publicUrl))
    expect(calls.uploadImage).toHaveBeenCalledWith(file, 'message')
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    expect(calls.create.mock.calls[0][0].definition.media).toEqual([media])
    expect(JSON.parse(calls.create.mock.calls[0][0].definition.template.messageContent)[0].thumbnailImageUrl).toBe(media.publicUrl)
    await waitFor(() => expect(screen.queryByLabelText('カードの画像ファイル')).toBeNull())
    expect(calls.deleteImage).not.toHaveBeenCalledWith(media.r2Key)
  })

  it('カルーセルは店のカルーセルを作る画面で作り、ボタンは URL を開くだけ', async () => {
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click(await screen.findByRole('tab', { name: /カルーセル/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: /テンプレートを作る/ }))[0])
    expect(await screen.findByRole('heading', { name: 'カルーセルを作る' })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('例：夏の定番5点'), { target: { value: '定期便のご案内' } })
    fireEvent.click(screen.getByRole('button', { name: '保存して配る' }))
    expect((await screen.findByText('すべてのカードに本文を入力してください'))).toBeTruthy()
    expect(calls.create).not.toHaveBeenCalled()
  })
})

describe('統括のテンプレートの詳細（pQ4fH）', () => {
  it('名前を押すと詳細。配った先のアカウント名と［このアカウントへ入る］・［アカウントへ配る］を出す', async () => {
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click(await screen.findByRole('button', { name: '予約前日のご案内' }))
    expect(await screen.findByRole('heading', { name: '配った先' })).toBeTruthy()
    expect(screen.getByText('4 アカウントに配りました。新しい版を配ると、4 アカウントのテンプレートが新しい版になります。')).toBeTruthy()
    expect(screen.getByText('ほか 1 アカウント')).toBeTruthy()
    const enter = screen.getAllByRole('button', { name: /このアカウントへ入る/ })
    expect(enter).toHaveLength(2)
    fireEvent.click(enter[0])
    expect(selectAccount).toHaveBeenCalledWith('a-1')
    expect(push).toHaveBeenCalledWith('/templates')
    fireEvent.click(screen.getAllByRole('button', { name: /アカウントへ配る/ })[0])
    expect(await screen.findByRole('checkbox', { name: /然 -NEN- 渋谷店/ })).toBeTruthy()
  })
})

describe('統括のテンプレートの詳細の版（pQ4fH・API-18）', () => {
  it('配った先ごとの版と版の履歴を出し、前の版を比べる・この版に戻す', async () => {
    const version = (n: number, draft: boolean, current: boolean) => ({ id: `v${n}`, version: n, created_by: 's', creator_name: n === 2 ? 'Masato' : 'Kenta Kawano', created_at: '2026-08-21T09:02:00Z', is_draft: draft, is_current: current })
    calls.versions.mockResolvedValue([version(3, true, true), version(2, false, false), version(1, false, false)])
    calls.receivedVersions.mockResolvedValue([
      { accountId: 'a-1', accountName: '然 -NEN- 本店', receivedAt: null, targetVersion: { version: 2, latestVersion: 3, status: 'older', label: '版2' } },
      { accountId: 'a-2', accountName: '然 -NEN- 渋谷店', receivedAt: null, targetVersion: { version: 3, latestVersion: 3, status: 'latest', label: '版3' } },
    ])
    calls.compareVersions.mockResolvedValue({ from: { version: version(1, false, false), definition: { schemaVersion: 1, template: { messageContent: '古い本文' } } }, to: { version: version(3, true, true), definition: { schemaVersion: 1, template: { messageContent: '新しい本文' } } }, changed: true })
    calls.restoreVersion.mockResolvedValue({ ...detail(), template: { ...detail().template, revision: 4 } })
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click(await screen.findByRole('button', { name: '予約前日のご案内' }))
    expect(await screen.findByText('版3（いまの版）')).toBeTruthy()
    expect(screen.getByText('新しい版を未配布')).toBeTruthy()
    expect(screen.getByText('配っていない変更があります')).toBeTruthy()
    expect(screen.getByText('下書き（まだ配っていない）')).toBeTruthy()
    expect(screen.getByText('いま使っている版')).toBeTruthy()
    const history = screen.getByRole('region', { name: '版の履歴' })
    fireEvent.click(within(history).getByRole('button', { name: '比べる' }))
    await waitFor(() => expect(calls.compareVersions).toHaveBeenCalledWith('t-1', 1, 3))
    expect(await screen.findByText('＋ 新しい本文')).toBeTruthy()
    fireEvent.click(within(history).getByRole('button', { name: /この版に戻す/ }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'この版に戻す' }))
    await waitFor(() => expect(calls.restoreVersion).toHaveBeenCalledWith('t-1', 1, 3))
  })
})

describe('統括の回答フォームの編集（u5MM7：店の回答フォームの編集画面＋配る口）', () => {
  const layout = {
    version: 2, header: [],
    sections: [{ id: 's-1', name: '来店について', blocks: [{ id: 'b-1', kind: 'input', type: 'radio', name: 'purpose', label: '今日のご来店の目的は？', required: true, choices: [{ id: 'c-1', label: 'トリミング' }] }] }],
    options: {},
  }
  const formDefinition = { schemaVersion: 1, form: { name: '来店アンケート', description: null, fields: [{ name: 'purpose', label: '今日のご来店の目的は？', type: 'radio', required: true, options: ['トリミング'] }], layout, on_submit_tag_id: null, on_submit_scenario_id: 'scn-keep', save_to_metadata: true } }
  const formRow = { id: 'f-t-1', name: '来店アンケート', description: null, template_type: 'form', folder_id: null, revision: 3, updated_at: '2026-08-21T09:02:00Z', content_summary: '質問 1', distributed_account_count: 3, distributed_account_names: ['本店', '渋谷店', 'イベント'], distributed_account_more: 0 }

  beforeEach(() => {
    calls.list.mockResolvedValue([formRow])
    calls.get.mockResolvedValue({ template: formRow, definition: formDefinition })
    calls.update.mockImplementation(async (_id: string, input: { name: string; definition: unknown }) => ({ template: { ...formRow, revision: 4, name: input.name }, definition: input.definition }))
  })

  it('名前を押すと店と同じ3つのタブの編集画面。右は「配った先」、［保存して配る］で統括のひな形を直してアカウントへ配るへ進む', async () => {
    render(<HqTemplatesV8 type="form" />)
    fireEvent.click(await screen.findByRole('button', { name: '来店アンケート' }))
    expect(await screen.findByRole('heading', { name: '配った先' })).toBeTruthy()
    expect(screen.getByText('配った先：3 アカウント（本店・渋谷店・イベント）。各アカウントでは回答フォームとして使えます。')).toBeTruthy()
    expect(screen.getByRole('tab', { name: '答え終わったあと' })).toBeTruthy()
    /* 店の口（回答用URL・公開・公開前に試す）は出さない。 */
    expect(screen.queryByText('回答用URL')).toBeNull()
    expect(screen.queryByRole('button', { name: /この版を公開/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /公開前に試す/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存して配る' }))
    await waitFor(() => expect(calls.update).toHaveBeenCalled())
    const [id, input] = calls.update.mock.calls[0]
    expect(id).toBe('f-t-1')
    expect(input).toMatchObject({ type: 'form', name: '来店アンケート', expectedRevision: 3 })
    /* 画面に出ない設定（答えたあとのシナリオ）は落とさない。 */
    expect(input.definition.form).toMatchObject({ on_submit_scenario_id: 'scn-keep', fields: [{ name: 'purpose' }] })
    expect(await screen.findByRole('checkbox', { name: /然 -NEN- 本店/ })).toBeTruthy()
  })

  it('［下書きを保存］は保存して一覧へ戻り、配るへは進まない', async () => {
    render(<HqTemplatesV8 type="form" />)
    fireEvent.click(await screen.findByRole('button', { name: '来店アンケート' }))
    fireEvent.click(await screen.findByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(calls.update).toHaveBeenCalled())
    expect(screen.queryByRole('checkbox', { name: /然 -NEN- 本店/ })).toBeNull()
  })
})

describe('統括のテンプレートを作る（リッチメッセージ g8d6ai）', () => {
  it('リッチメッセージのタブから作ると店のリッチメッセージの作る画面。画像は統括の置き場へ送り、面と URL を統括のひな形の素材にする', async () => {
    const media = [240, 300, 460, 700, 1040].map((width) => ({ id: `m-${width}`, kind: 'image', filename: `${width}.png`, mimeType: 'image/png', sizeBytes: 1, width, height: width, durationMs: null, r2Key: `hq/rich/${width}`, publicUrl: null, versionId: 'v1', versionNo: 1, contentHash: 'h' }))
    calls.uploadRichMessageImage.mockResolvedValue({ media, payload: { imageUrl: 'https://img.test/rich/1040', baseUrl: 'https://img.test/rich', baseSize: { width: 1040, height: 1040 } } })
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click(await screen.findByRole('tab', { name: /リッチメッセージ/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: /テンプレートを作る/ }))[0])
    expect(await screen.findByRole('heading', { name: 'リッチメッセージを作る' })).toBeTruthy()
    /* 普通のメッセージの作る画面（X4JcOf）には入らない。 */
    expect(screen.queryByLabelText('本文')).toBeNull()
    expect(screen.queryByRole('button', { name: '登録メディアから選ぶ' })).toBeNull()
    fireEvent.change(screen.getByLabelText('テンプレート名'), { target: { value: '夏のキャンペーン告知' } })
    const file = new File(['png'], 'summer.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('リッチメッセージの画像のファイル'), { target: { files: [file] } })
    await waitFor(() => expect(calls.uploadRichMessageImage).toHaveBeenCalledWith(file))
    fireEvent.click(screen.getByRole('button', { name: '1面' }))
    fireEvent.click(screen.getByRole('button', { name: '面 A を押したら' }))
    expect(screen.queryByRole('option', { name: '動きを実行する' })).toBeNull()
    fireEvent.click(within(await screen.findByRole('option', { name: 'URLを開く' })).getByRole('button'))
    fireEvent.change(screen.getByLabelText('面 A のURL'), { target: { value: 'https://nen.example/summer' } })
    fireEvent.click(screen.getByRole('button', { name: '保存して配る' }))
    await waitFor(() => expect(calls.create).toHaveBeenCalled())
    const definition = calls.create.mock.calls[0][0].definition
    expect(definition.asset.kind).toBe('rich_message')
    expect(definition.asset.payload).toMatchObject({ baseUrl: 'https://img.test/rich', shape: '1', tapAreas: [{ actionType: 'uri', uri: 'https://nen.example/summer' }] })
    expect(definition.media).toHaveLength(5)
    expect(await screen.findByRole('checkbox', { name: /然 -NEN- 本店/ })).toBeTruthy()
  })
})

describe('統括のテンプレートを直す（質問・クーポン：店の作る画面で、保存してある中身から）', () => {
  const question = { text: 'どのコースが好きですか？', tapMode: 'single', choices: [{ label: '鹿肉', behavior: 'none' }, { label: '馬肉', behavior: 'none' }] }
  const questionDefinition = { ...message, template: { ...message.template, name: '好みのコース', questionJson: JSON.stringify(question), questionStatus: 'published' } }
  const coupon = { description: '会計時にご提示ください', startsAt: '2026-12-01T00:00', endsAt: '2026-12-31T23:59', oncePerFriend: true, visibility: 'friends', lottery: false }
  const couponDefinition = { ...message, asset: { kind: 'coupon', payload: coupon }, template: { ...message.template, name: '冬の10%オフ', messageContent: '' } }
  const open = async (definition: unknown, rowKind: string, rowName: string) => {
    const row = { ...listRow, name: rowName, kind: rowKind }
    calls.list.mockResolvedValue([row]); calls.listByKind.mockResolvedValue([row])
    calls.get.mockResolvedValue({ template: { ...detail().template, name: rowName }, definition })
    calls.update.mockImplementation(async (_id: string, input: { name: string; definition: unknown }) => ({ template: { ...detail().template, name: input.name, revision: 4 }, definition: input.definition }))
    render(<HqTemplatesV8 type="template" />)
    fireEvent.click(await screen.findByRole('button', { name: rowName }))
    fireEvent.click(await screen.findByRole('button', { name: /編集する/ }))
  }

  it('質問は保存してある質問文・選択肢で店の質問の画面が開き、直して保存すると同じ形で統括のひな形を更新する', async () => {
    await open(questionDefinition, 'question', '好みのコース')
    expect(await screen.findByDisplayValue('どのコースが好きですか？')).toBeTruthy()
    expect(screen.getByDisplayValue('馬肉')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^質問文/), { target: { value: 'どのお肉が好きですか？' } })
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(calls.update).toHaveBeenCalled())
    const [, input] = calls.update.mock.calls[0]
    expect(input.expectedRevision).toBe(3)
    expect(JSON.parse(input.definition.template.questionJson)).toMatchObject({ text: 'どのお肉が好きですか？', choices: [{ label: '鹿肉' }, { label: '馬肉' }] })
  })

  it('クーポンは保存してある期間・説明で店のクーポンの画面が開き、そのまま保存しても期間を落とさない', async () => {
    await open(couponDefinition, 'coupon', '冬の10%オフ')
    expect(await screen.findByRole('heading', { name: 'クーポンを作る' })).toBeTruthy()
    expect(screen.getByDisplayValue('冬の10%オフ')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(calls.update).toHaveBeenCalled())
    const [, input] = calls.update.mock.calls[0]
    expect(input.definition.asset).toMatchObject({ kind: 'coupon', payload: { description: '会計時にご提示ください', startsAt: '2026-12-01T00:00', endsAt: '2026-12-31T23:59' } })
  })
})
