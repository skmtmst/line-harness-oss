// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  account: 'account-1',
  foldersList: vi.fn(),
  friendFieldsList: vi.fn(),
  listEvents: vi.fn(),
  createDraft: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))

/*
 * 共通の Select は listbox の部品で、その操作は部品自身の試験が持つ。
 * ここで見たいのは選んだ後の起点の判断なので、素の <select> に置き換える。
 */
vi.mock('@/components/shared/select', () => ({
  default: ({ 'aria-label': label, value, onChange, options }: {
    'aria-label'?: string
    value: string
    onChange: (value: string) => void
    options: Array<{ value: string; label: string }>
  }) => React.createElement(
    'select',
    { 'aria-label': label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) },
    options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
  ),
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.account, loading: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))
vi.mock('@/lib/api', () => ({
  api: {
    folders: { list: fixture.foldersList },
    friendFields: { list: fixture.friendFieldsList },
    reminders: { createDraft: fixture.createDraft },
    // 下書きの自動保存は閲覧のみの人には動かさないため、役割を読む。
    staff: { me: async () => ({ success: true, data: { role: 'owner' } }) },
  },
  eventsApi: { listEvents: fixture.listEvents },
}))

import NewReminderPage from './page'

function fieldsOf(accountId: string) {
  return [
    { id: `field-birthday-${accountId}`, name: '誕生日', type: 'date' },
    { id: `field-note-${accountId}`, name: '自由メモ', type: 'text' },
    { id: `field-contract-end-${accountId}`, name: '契約終了日', type: 'datetime' },
  ]
}

beforeEach(() => {
  // V8 の作る画面を見る。本番は v7 のままなので分岐は残す。
  document.documentElement.dataset.theme = 'v8'
  fixture.account = 'account-1'
  fixture.foldersList.mockResolvedValue({ success: true, data: [] })
  fixture.friendFieldsList.mockImplementation((accountId: string) =>
    Promise.resolve({ success: true, data: fieldsOf(accountId) }),
  )
  fixture.listEvents.mockResolvedValue({
    items: [
      { id: 'event-1', name: '9月の説明会' },
      { id: 'event-2', name: '10月の体験会' },
    ],
    total: 2, limit: 100, sort: [],
  })
  fixture.createDraft.mockResolvedValue({
    success: true,
    data: { reminderId: 'r-new', versionId: 'v-1', versionNumber: 1, status: 'draft', settings: {}, lastTestStatus: null, lastTestedAt: null, publishedAt: null },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function fillName(value = 'テスト用リマインダ') {
  fireEvent.change(screen.getByPlaceholderText('例：予約前日のご案内'), { target: { value } })
}

function goNext() {
  fireEvent.click(screen.getByRole('button', { name: '次へ：対象者と止める条件' }))
}

/** 候補の読み込みが終わり、次へが押せるようになるまで待つ。 */
async function waitNextEnabled() {
  await waitFor(() => {
    const next = screen.getByRole('button', { name: '次へ：対象者と止める条件' }) as HTMLButtonElement
    expect(next.disabled).toBe(false)
  })
}

/** ひな形カード群の中で、指定の順番の「このひな形を使う」を押す（V8は表ではなくカード）。 */
function useTemplateAt(index: number) {
  const buttons = screen.getAllByRole('button', { name: 'このひな形を使う' })
  fireEvent.click(buttons[index])
}

/** 情報欄プルダウンに accountId の候補が並ぶまで待つ。 */
async function waitFieldOptions(accountId: string) {
  await waitFor(() => {
    const select = screen.getByLabelText('基準日に使う情報欄') as HTMLSelectElement
    expect([...select.options].some((option) => option.value === `field-birthday-${accountId}`)).toBe(true)
  })
}

describe('起点の実在候補選択', () => {
  it('友だち情報欄を選ぶと日付型の項目だけが選べる', async () => {
    render(<NewReminderPage />)
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))

    await waitFor(() => expect(fixture.friendFieldsList).toHaveBeenCalledWith('account-1'))
    await waitFor(() => {
      const select = screen.getByLabelText('基準日に使う情報欄') as HTMLSelectElement
      const labels = [...select.options].map((option) => option.textContent)
      expect(labels).toContain('誕生日')
      expect(labels).toContain('契約終了日')
      expect(labels).not.toContain('自由メモ')
    })
  })

  it('情報欄を選ばないままでは作成しない', async () => {
    render(<NewReminderPage />)
    fillName()
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))
    await waitFieldOptions('account-1')
    await waitNextEnabled()

    goNext()
    await screen.findByText('基準日に使う友だち情報欄を選んでください')
    expect(fixture.createDraft).not.toHaveBeenCalled()
  })

  it('選んだ情報欄をtriggerFieldIdとして保存する', async () => {
    render(<NewReminderPage />)
    fillName()
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))
    await waitFieldOptions('account-1')
    fireEvent.change(screen.getByLabelText('基準日に使う情報欄'), { target: { value: 'field-birthday-account-1' } })

    goNext()
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    const settings = fixture.createDraft.mock.calls[0][0]
    expect(settings.triggerType).toBe('friend_field')
    expect(settings.triggerFieldId).toBe('field-birthday-account-1')
    expect(settings.triggerEventId).toBeNull()
  })

  // #996 DEEP-04: カードは「フォーム回答日」ではなく「イベントの予約日時」。
  // 選ぶと triggerType=event・triggerEventId（予約の開始日時起点）を保存する。
  it('「イベントの予約日時」を選ぶと実在イベントの一覧から起点を選ぶ', async () => {
    render(<NewReminderPage />)
    fillName()
    expect(screen.queryByRole('button', { name: /フォーム回答日/ })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: /イベントの予約日時/ }))

    await waitFor(() => expect(fixture.listEvents).toHaveBeenCalled())
    await waitFor(() => {
      const select = screen.getByLabelText('基準日にするイベント') as HTMLSelectElement
      expect([...select.options].some((option) => option.value === 'event-2')).toBe(true)
    })
    fireEvent.change(screen.getByLabelText('基準日にするイベント'), { target: { value: 'event-2' } })

    goNext()
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    const settings = fixture.createDraft.mock.calls[0][0]
    expect(settings.triggerType).toBe('event')
    expect(settings.triggerEventId).toBe('event-2')
    expect(settings.triggerFieldId).toBeNull()
  })

  it('イベントを選ばないままでは作成しない', async () => {
    render(<NewReminderPage />)
    fillName()
    fireEvent.click(screen.getByRole('radio', { name: /イベントの予約日時/ }))
    await waitFor(() => {
      const select = screen.getByLabelText('基準日にするイベント') as HTMLSelectElement
      expect([...select.options].some((option) => option.value === 'event-1')).toBe(true)
    })
    await waitNextEnabled()

    goNext()
    await screen.findByText('基準日にするイベントを選んでください')
    expect(fixture.createDraft).not.toHaveBeenCalled()
  })
})

// #996 DEEP-05: アカウント切替で前アカウントの候補・選択IDを残さない。
describe('アカウント切替', () => {
  it('切り替えると候補・選択IDを捨てて、新しいアカウントの候補を取り直す', async () => {
    fixture.account = 'account-A'
    const view = render(<NewReminderPage />)
    fillName('誕生日案内')
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))
    await waitFieldOptions('account-A')
    fireEvent.change(screen.getByLabelText('基準日に使う情報欄'), { target: { value: 'field-birthday-account-A' } })

    fixture.account = 'account-B'
    view.rerender(<NewReminderPage />)

    // Bの候補を取り直し、Aの選択IDは残さない
    await waitFor(() => expect(fixture.friendFieldsList).toHaveBeenCalledWith('account-B'))
    await waitFor(() => {
      const select = screen.getByLabelText('基準日に使う情報欄') as HTMLSelectElement
      expect(select.value).toBe('')
      expect([...select.options].some((option) => option.value === 'field-birthday-account-B')).toBe(true)
      expect([...select.options].some((option) => option.value === 'field-birthday-account-A')).toBe(false)
    })

    // Bの候補で保存すれば、保存先アカウントと情報欄IDが一致する
    fireEvent.change(screen.getByLabelText('基準日に使う情報欄'), { target: { value: 'field-birthday-account-B' } })
    goNext()
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    const settings = fixture.createDraft.mock.calls[0][0]
    expect(settings.lineAccountId).toBe('account-B')
    expect(settings.triggerFieldId).toBe('field-birthday-account-B')
  })

  it('前アカウントの遅い応答が届いても、今の候補を上書きしない', async () => {
    let resolveA: ((value: unknown) => void) | null = null
    fixture.friendFieldsList.mockImplementation((accountId: string) =>
      accountId === 'account-A'
        ? new Promise((resolve) => { resolveA = resolve })
        : Promise.resolve({ success: true, data: fieldsOf(accountId) }),
    )
    fixture.account = 'account-A'
    const view = render(<NewReminderPage />)
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))
    await waitFor(() => expect(fixture.friendFieldsList).toHaveBeenCalledWith('account-A'))

    // Aの応答が届く前にBへ切り替える
    fixture.account = 'account-B'
    view.rerender(<NewReminderPage />)
    await waitFor(() => expect(fixture.friendFieldsList).toHaveBeenCalledWith('account-B'))
    await waitFieldOptions('account-B')

    // 逆順でAの応答が届いても、Bの候補は入れ替わらない
    await act(async () => {
      resolveA?.({ success: true, data: fieldsOf('account-A') })
    })
    const select = screen.getByLabelText('基準日に使う情報欄') as HTMLSelectElement
    expect([...select.options].some((option) => option.value === 'field-birthday-account-A')).toBe(false)
    expect([...select.options].some((option) => option.value === 'field-birthday-account-B')).toBe(true)
  })

  it('切替直後・候補の再取得が終わるまで次へ進めない', async () => {
    let resolveB: ((value: unknown) => void) | null = null
    fixture.friendFieldsList.mockImplementation((accountId: string) =>
      accountId === 'account-B'
        ? new Promise((resolve) => { resolveB = resolve })
        : Promise.resolve({ success: true, data: fieldsOf(accountId) }),
    )
    fixture.account = 'account-A'
    const view = render(<NewReminderPage />)
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))
    await waitFieldOptions('account-A')
    fireEvent.change(screen.getByLabelText('基準日に使う情報欄'), { target: { value: 'field-birthday-account-A' } })

    fixture.account = 'account-B'
    view.rerender(<NewReminderPage />)
    await waitFor(() => expect(fixture.friendFieldsList).toHaveBeenCalledWith('account-B'))

    // Bの候補が確定するまで「次へ」は無効
    const next = screen.getByRole('button', { name: '次へ：対象者と止める条件' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    expect(fixture.createDraft).not.toHaveBeenCalled()

    await act(async () => {
      resolveB?.({ success: true, data: fieldsOf('account-B') })
    })
    await waitFor(() => expect((screen.getByRole('button', { name: '次へ：対象者と止める条件' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('新しいアカウントに日付型の情報欄が0件なら、前の候補を残さず0件と出す', async () => {
    fixture.friendFieldsList.mockImplementation((accountId: string) =>
      Promise.resolve({ success: true, data: accountId === 'account-B' ? [] : fieldsOf(accountId) }),
    )
    fixture.account = 'account-A'
    const view = render(<NewReminderPage />)
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))
    await waitFieldOptions('account-A')

    fixture.account = 'account-B'
    view.rerender(<NewReminderPage />)
    await screen.findByText('このアカウントに日付型の情報欄がまだありません。友だち情報欄から追加してください。')
    const select = screen.getByLabelText('基準日に使う情報欄') as HTMLSelectElement
    expect(select.value).toBe('')
    expect([...select.options].some((option) => option.value === 'field-birthday-account-A')).toBe(false)
  })
})

// #996 DEEP-06/07: ひな形を選んだときだけ用途に合う本文・時刻を入れる。
describe('ひな形から作る', () => {
  it('ひな形を選ばない下書きは本文・送信時刻を確定させない（Meet文面を入れない）', async () => {
    render(<NewReminderPage />)
    fillName('誕生日のお祝い')
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))
    await waitFieldOptions('account-1')
    fireEvent.change(screen.getByLabelText('基準日に使う情報欄'), { target: { value: 'field-birthday-account-1' } })

    goNext()
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    const settings = fixture.createDraft.mock.calls[0][0]
    /*
     * REMINDER-07: 空の1通目は作らない。空本文の通はWorkerの下書き検査で
     * 弾かれ基本設定から先へ進めなかった。通知0件の未完成下書きとして
     * 保存し、本文は STEP 3 の通知編集で作る。
     */
    expect(settings.steps).toEqual([])
    expect(settings.sendAtTime).toBeNull()
  })

  it('「誕生日のお祝い」を使うと起点・繰り返し・時刻がまとめて入る', async () => {
    render(<NewReminderPage />)
    fillName('誕生日のお祝い')

    useTemplateAt(3)

    // friend_field 起点へ切り替わり、「誕生日」の情報欄が自動で選ばれる
    await waitFor(() => expect(fixture.friendFieldsList).toHaveBeenCalledWith('account-1'))
    await waitFor(() => {
      expect((screen.getByLabelText('基準日に使う情報欄') as HTMLSelectElement).value).toBe('field-birthday-account-1')
    })
    // 毎年くり返す → 2/29の扱いが出る
    await screen.findByLabelText('2月29日が基準日のとき')
    expect((screen.getByLabelText('毎年くり返す') as HTMLInputElement).checked).toBe(true)
    // 右の要点にも反映される
    expect(screen.getByText('1通（当日 10:00）')).toBeTruthy()

    goNext()
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    const settings = fixture.createDraft.mock.calls[0][0]
    expect(settings.triggerType).toBe('friend_field')
    expect(settings.triggerFieldId).toBe('field-birthday-account-1')
    expect(settings.repeatYearly).toBe(true)
    expect(settings.sendAtTime).toBe('10:00')
    expect(settings.steps[0].offsetDays).toBe(0)
    expect(settings.steps[0].sendAtTime).toBe('10:00')
    expect(settings.steps[0].messageContent).toContain('お誕生日おめでとうございます')
    expect(settings.steps[0].messageContent).not.toContain('Google Meet')
  })

  it('「予約の前日案内」を使うと予約起点の前日18時が入る', async () => {
    render(<NewReminderPage />)
    fillName('前日案内')

    useTemplateAt(0)
    expect((screen.getByRole('radio', { name: /^予約日時/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('1通（1日前 18:00）')).toBeTruthy()

    goNext()
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    const settings = fixture.createDraft.mock.calls[0][0]
    expect(settings.triggerType).toBe('booking')
    expect(settings.steps[0].offsetDays).toBe(-1)
    expect(settings.steps[0].sendAtTime).toBe('18:00')
    expect(settings.steps[0].messageContent).toContain('Google Meet')
  })

  it('すでに起点を選んでいるときは、置き換えるか確認してから適用する', async () => {
    render(<NewReminderPage />)
    fillName('確認つき')
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))
    await waitFieldOptions('account-1')
    fireEvent.change(screen.getByLabelText('基準日に使う情報欄'), { target: { value: 'field-birthday-account-1' } })

    useTemplateAt(0)

    // 確認を出し、承認したときだけ置き換える
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/置き換わります/)).toBeTruthy()
    expect(screen.getByLabelText('基準日に使う情報欄')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'このひな形を使う' }))

    await waitFor(() => expect(screen.queryByLabelText('基準日に使う情報欄')).toBeNull())
    goNext()
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    expect(fixture.createDraft.mock.calls[0][0].triggerType).toBe('booking')
  })

  it('確認をやめれば入力はそのまま残る', async () => {
    render(<NewReminderPage />)
    fillName('確認キャンセル')
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))
    await waitFieldOptions('account-1')
    fireEvent.change(screen.getByLabelText('基準日に使う情報欄'), { target: { value: 'field-birthday-account-1' } })

    useTemplateAt(0)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))

    expect((screen.getByLabelText('基準日に使う情報欄') as HTMLSelectElement).value).toBe('field-birthday-account-1')
  })
})

// 右の要点は作る前から「下書き」と出し、作らずに進まない。
describe('保存状態の表示', () => {
  it('作成APIを呼ぶ前は右の要点が「下書き」で、次へ進まない', async () => {
    render(<NewReminderPage />)
    await screen.findByRole('button', { name: '次へ：対象者と止める条件' })
    expect(fixture.createDraft).not.toHaveBeenCalled()
    expect(fixture.routerPush).not.toHaveBeenCalled()
    expect(screen.getByText('下書き')).toBeTruthy()
  })

  it('保存に失敗したら失敗と出し、次の画面へ進まない', async () => {
    fixture.createDraft.mockResolvedValue({ success: false, error: '保存に失敗しました。通信を確かめて、もう一度お試しください。' })
    render(<NewReminderPage />)
    fillName()
    goNext()

    await screen.findByText('保存に失敗しました。通信を確かめて、もう一度お試しください。')
    expect(fixture.routerPush).not.toHaveBeenCalled()
  })
})

describe('2月29日の扱い（3択）', () => {
  async function chooseBirthdayField() {
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))
    await waitFieldOptions('account-1')
    fireEvent.change(screen.getByLabelText('基準日に使う情報欄'), { target: { value: 'field-birthday-account-1' } })
  }

  it('「毎年くり返す」を付けると3択が出て、既定は 2月28日', async () => {
    render(<NewReminderPage />)
    fillName()
    await chooseBirthdayField()

    expect(screen.queryByLabelText('2月29日が基準日のとき')).toBeNull()
    fireEvent.click(screen.getByLabelText('毎年くり返す'))

    const select = await screen.findByLabelText('2月29日が基準日のとき') as HTMLSelectElement
    expect(select.value).toBe('feb28')
    expect([...select.options].map((option) => option.textContent))
      .toEqual(['2月28日に届ける', '3月1日に届ける', 'その年は届けない'])
  })

  it('選んだ方針を repeatYearly と一緒に保存する', async () => {
    render(<NewReminderPage />)
    fillName()
    await chooseBirthdayField()
    fireEvent.click(screen.getByLabelText('毎年くり返す'))
    fireEvent.change(await screen.findByLabelText('2月29日が基準日のとき'), { target: { value: 'skip' } })

    goNext()
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    const settings = fixture.createDraft.mock.calls[0][0]
    expect(settings.repeatYearly).toBe(true)
    expect(settings.leapYearPolicy).toBe('skip')
  })

  it('くり返さない基準日では repeatYearly は false のまま保存する', async () => {
    render(<NewReminderPage />)
    fillName()
    await chooseBirthdayField()

    goNext()
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    const settings = fixture.createDraft.mock.calls[0][0]
    expect(settings.repeatYearly).toBe(false)
    expect(settings.leapYearPolicy).toBe('feb28')
  })
})

describe('未保存の入力保護', () => {
  it('入力途中で離れようとすると確認を出す', async () => {
    render(<NewReminderPage />)
    fillName()
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('何も入力していなければ確認を出さない', async () => {
    render(<NewReminderPage />)
    await screen.findByRole('button', { name: '次へ：対象者と止める条件' })
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
