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
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: fixture.account, loading: false }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.routerPush }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    folders: { list: fixture.foldersList },
    friendFields: { list: fixture.friendFieldsList },
    reminders: { createDraft: fixture.createDraft },
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
  fireEvent.change(screen.getByPlaceholderText('例：Google Meet相談の前日案内'), { target: { value } })
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

    fireEvent.click(screen.getByRole('button', { name: /対象設定へ/ }))
    await screen.findByText('基準日に使う友だち情報欄を選んでください')
    expect(fixture.createDraft).not.toHaveBeenCalled()
  })

  it('選んだ情報欄をtriggerFieldIdとして保存する', async () => {
    render(<NewReminderPage />)
    fillName()
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))
    await waitFieldOptions('account-1')
    fireEvent.change(screen.getByLabelText('基準日に使う情報欄'), { target: { value: 'field-birthday-account-1' } })

    fireEvent.click(screen.getByRole('button', { name: /対象設定へ/ }))
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

    fireEvent.click(screen.getByRole('button', { name: /対象設定へ/ }))
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

    fireEvent.click(screen.getByRole('button', { name: /対象設定へ/ }))
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
    fireEvent.click(screen.getByRole('button', { name: /対象設定へ/ }))
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
    const next = screen.getByRole('button', { name: /対象設定へ/ }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    expect(fixture.createDraft).not.toHaveBeenCalled()

    await act(async () => {
      resolveB?.({ success: true, data: fieldsOf('account-B') })
    })
    await waitFor(() => expect((screen.getByRole('button', { name: /対象設定へ/ }) as HTMLButtonElement).disabled).toBe(false))
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

    fireEvent.click(screen.getByRole('button', { name: /対象設定へ/ }))
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

  it('「誕生日のお祝い」を使うと起点・繰り返し・本文・時刻がまとめて入る', async () => {
    render(<NewReminderPage />)
    fillName('誕生日のお祝い')

    const row = screen.getByText('誕生日のお祝い').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'このひな形を使う' }))

    // friend_field 起点へ切り替わり、「誕生日」の情報欄が自動で選ばれる
    await waitFor(() => expect(fixture.friendFieldsList).toHaveBeenCalledWith('account-1'))
    await waitFor(() => {
      expect((screen.getByLabelText('基準日に使う情報欄') as HTMLSelectElement).value).toBe('field-birthday-account-1')
    })
    // 毎年くり返す → 2/29の扱いが出る
    await screen.findByLabelText('2月29日が基準日のときの平年の扱い')
    // サマリーとプレビューにも反映される
    expect(screen.getByText('1通（当日 10:00）')).toBeTruthy()
    expect(screen.getByText(/お誕生日おめでとうございます/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /対象設定へ/ }))
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

  it('「予約の前日案内」を使うと予約起点の前日18時の文面が入る', async () => {
    render(<NewReminderPage />)
    fillName('前日案内')

    const row = screen.getByText('予約の前日案内').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'このひな形を使う' }))

    fireEvent.click(screen.getByRole('button', { name: /対象設定へ/ }))
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

    const row = screen.getByText('予約の前日案内').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'このひな形を使う' }))

    // 確認を出し、承認したときだけ置き換える
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/置き換わります/)).toBeTruthy()
    expect(screen.getByLabelText('基準日に使う情報欄')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'このひな形を使う' }))

    await waitFor(() => expect(screen.queryByLabelText('基準日に使う情報欄')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /対象設定へ/ }))
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    expect(fixture.createDraft.mock.calls[0][0].triggerType).toBe('booking')
  })

  it('確認をやめれば入力はそのまま残る', async () => {
    render(<NewReminderPage />)
    fillName('確認キャンセル')
    fireEvent.click(screen.getByRole('radio', { name: /友だち情報欄の日付/ }))
    await waitFieldOptions('account-1')
    fireEvent.change(screen.getByLabelText('基準日に使う情報欄'), { target: { value: 'field-birthday-account-1' } })

    const row = screen.getByText('予約の前日案内').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'このひな形を使う' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'やめる' }))

    expect((screen.getByLabelText('基準日に使う情報欄') as HTMLSelectElement).value).toBe('field-birthday-account-1')
  })
})

// #996 DEEP-27: createDraft未呼出の段階で「下書き保存」と出さない。
describe('保存状態の表示', () => {
  it('作成APIを呼ぶ前は「未保存」とだけ出す', async () => {
    render(<NewReminderPage />)
    await screen.findByRole('button', { name: /対象設定へ/ })
    expect(fixture.createDraft).not.toHaveBeenCalled()
    expect(screen.queryByText('下書き保存')).toBeNull()
    expect(screen.getAllByText('未保存').length).toBeGreaterThan(0)
  })

  it('保存に失敗したら失敗と出し、次の画面へ進まない', async () => {
    fixture.createDraft.mockResolvedValue({ success: false, error: '保存に失敗しました。通信を確かめて、もう一度お試しください。' })
    render(<NewReminderPage />)
    fillName()
    fireEvent.click(screen.getByRole('button', { name: /対象設定へ/ }))

    await screen.findByText('下書きを保存できませんでした')
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

    expect(screen.queryByLabelText('2月29日が基準日のときの平年の扱い')).toBeNull()
    fireEvent.click(screen.getByLabelText('毎年くり返す'))

    const select = await screen.findByLabelText('2月29日が基準日のときの平年の扱い') as HTMLSelectElement
    expect(select.value).toBe('feb28')
    expect([...select.options].map((option) => option.textContent))
      .toEqual(['2月28日に届ける', '3月1日に届ける', 'その年は届けない'])
  })

  it('選んだ方針を repeatYearly と一緒に保存する', async () => {
    render(<NewReminderPage />)
    fillName()
    await chooseBirthdayField()
    fireEvent.click(screen.getByLabelText('毎年くり返す'))
    fireEvent.change(await screen.findByLabelText('2月29日が基準日のときの平年の扱い'), { target: { value: 'skip' } })

    fireEvent.click(screen.getByRole('button', { name: /対象設定へ/ }))
    await waitFor(() => expect(fixture.createDraft).toHaveBeenCalled())
    const settings = fixture.createDraft.mock.calls[0][0]
    expect(settings.repeatYearly).toBe(true)
    expect(settings.leapYearPolicy).toBe('skip')
  })

  it('くり返さない基準日では repeatYearly は false のまま保存する', async () => {
    render(<NewReminderPage />)
    fillName()
    await chooseBirthdayField()

    fireEvent.click(screen.getByRole('button', { name: /対象設定へ/ }))
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
    await screen.findByRole('button', { name: /対象設定へ/ })
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
