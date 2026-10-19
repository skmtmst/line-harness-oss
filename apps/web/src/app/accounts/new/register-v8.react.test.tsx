// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RegisterV8 from '@/v8/account-new/register'
import { allV8RowsPassed, toV8CheckRows } from '@/v8/account-new/logic'
import type { LineAccountConnectData } from '@/lib/api'

const calls = vi.hoisted(() => ({
  connectCheck: vi.fn(), connect: vi.fn(), list: vi.fn(), registrationReceipt: vi.fn(),
  followerImportState: vi.fn(), stepFollowerImport: vi.fn(), followerInsight: vi.fn(),
  staffList: vi.fn(), tagList: vi.fn(), tagCreate: vi.fn(), tagSet: vi.fn(), friendsList: vi.fn(),
}))
vi.mock('@/lib/api', () => ({
  api: {
    lineAccounts: {
      connectCheck: calls.connectCheck,
      connect: calls.connect,
      list: calls.list,
      registrationReceipt: calls.registrationReceipt,
      followerImportState: calls.followerImportState,
      stepFollowerImport: calls.stepFollowerImport,
      followerInsight: calls.followerInsight,
    },
    staff: { list: calls.staffList },
    friends: { list: calls.friendsList },
    lineAccountTags: { list: calls.tagList, create: calls.tagCreate, setForAccount: calls.tagSet },
  },
}))
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,QR' } }))
vi.mock('@/components/step-up-prompt', () => ({
  default: () => null,
  isStepUpRequired: () => false,
}))
vi.mock('@/components/hq/notice-line-register-dialog', () => ({ default: () => null }))

const passedSteps = [
  'チャネルIDとシークレットでアクセストークンを発行',
  '公式アカウントの名前とアイコンを取得',
  'Webhook URLを登録して、実際に届くかテスト',
  'LINE Loginチャネルを確認して、LIFFアプリを作成',
  '認証済みアカウントかを判定',
].map((message, index) => ({ order: index + 1, state: 'passed', message }))

const baseData = {
  steps: passedSteps,
  verification: {
    tokenOk: true, loginOk: true, sameProvider: true,
    webhook: {
      expectedUrl: 'https://worker.test/webhook',
      registeredUrl: 'https://worker.test/webhook',
      active: true, testPassed: true,
    },
    followerTotal: 1284,
  },
  displayName: 'LINE公式名',
  pictureUrl: null,
  basicId: '@line',
  liffId: '2007123456-auto',
  followerImport: { capability: 'unavailable', phase: 'not_started' },
  remainingActions: [],
}

const checked = { success: true, data: baseData }

afterEach(() => {
  cleanup()
  try { window.localStorage.clear() } catch { /* 下書きが残っても次の試験は上書きする。 */ }
})
beforeEach(() => {
  vi.clearAllMocks()
  calls.connectCheck.mockResolvedValue(checked)
  calls.connect.mockResolvedValue({ success: true, data: { ...baseData, id: 'new-account' } })
  calls.list.mockResolvedValue({ success: true, data: [] })
  calls.registrationReceipt.mockResolvedValue({ success: true, data: { status: 'confirmed', receivedAt: '2026-10-20T10:00:02.000+09:00' } })
  calls.staffList.mockResolvedValue({ success: true, data: [] })
  calls.tagList.mockResolvedValue({ success: true, data: [] })
  calls.followerInsight.mockResolvedValue({ success: true, data: { followers: null } })
  calls.friendsList.mockResolvedValue({ success: true, data: { total: 0 } })
})

const fill = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } })
const next = () => fireEvent.click(screen.getByRole('button', { name: '次へ' }))
/** ②の中だけ進むボタンの名前が違う（v07 Fqy29）。 */
const nextStep = () => fireEvent.click(screen.getByRole('button', { name: '次のステップへ' }))
const back = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

const ack = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name }))
const pick = (name: string) => fireEvent.click(screen.getByRole('radio', { name }))

/**
 * ①事前確認（v07 p6zMkA）を抜ける。Q1=ある／Q2=引き継がない／Q4=使っていない を選ぶと
 * Q3・Q5は尋ねないので、3問＋チェック結果の「次へ」で②-1 Messaging API に入る。
 */
function clearPrecheck() {
  pick('はい、あります')
  next()
  pick('いいえ、引き継ぎません')
  next()
  pick('使っていません')
  next()
  next()
}

/**
 * v07（Fqy29）の順番どおり：①→②-1 Messaging API→②-2 Webhook→②-3 LINEログイン→③Step1。
 * 入力を変えると確認がやり直しになるので先に全部入れる。
 */
function enterCheckStep() {
  render(<RegisterV8 />)
  clearPrecheck()
  fill('v8-channel-id', '123456789')
  fill('v8-channel-secret', 'synthetic-secret')
  nextStep()
  ack('Webhook URL を貼り付けて「更新」を押した')
  ack('Webhookの利用をONにした')
  ack('Webhookの再送をONにした')
  ack('エラーの統計情報をONにした')
  nextStep()
  fill('v8-login-channel-id', '2007123456')
  fill('v8-login-channel-secret', 'synthetic-login-secret')
  ack('友だち追加オプションで、この公式アカウントをリンクした')
  ack('チャネルを「開発中」から「公開済み」にした')
  nextStep()
  expect(screen.getByRole('button', { name: '接続を確かめる' })).toBeTruthy()
}

/** 5行は1行ずつ順に出るので、すべて通って「登録する」が出るまで待つ。 */
async function runCheck() {
  fireEvent.click(screen.getByRole('button', { name: '接続を確かめる' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '登録する' })).toBeTruthy(), { timeout: 5000 })
}

describe('V8 登録ウィザードの gated 進行', () => {
  it('②Step1の2項目が空では次の段へ進めない', async () => {
    render(<RegisterV8 />)
    clearPrecheck()
    nextStep()
    expect(screen.getByText('チャネルIDを入力してください。')).toBeTruthy()
    const channel = document.getElementById('v8-channel-id')!
    expect(channel.getAttribute('aria-invalid')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(channel))
    expect(screen.queryByText('入力内容を確認してください。')).toBeNull()
    expect(calls.connectCheck).not.toHaveBeenCalled()
    expect(screen.queryByText('Webhook（受信のつなぎ）を設定する', { selector: 'h2' })).toBeNull()
  })

  /*
    絵の正本ノードは、ソース文字の検索ではなく実際に描かれた印で確かめる（B-273）。
    v07（LINE新規追加_v07.pen・2026-10-18承認）: p6zMkA=①／Fqy29=②／Lwxyh=③／X0pGdw=④／Plmq1=⑤。
    ノードとURLの対応は scripts/visual-qa/v8-design-map-route-contract.test.ts。
  */
  const shownNode = () => document.querySelector('[data-design-node]')?.getAttribute('data-design-node')

  it('5つの段は絵の正本ノードを描く', async () => {
    enterCheckStep()
    expect(shownNode()).toBe('Lwxyh')
    await runCheck()
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))
    await screen.findByText('友だち追加できるか確かめます', { selector: 'h2' })
    expect(shownNode()).toBe('Lwxyh')
    await waitFor(() => expect((screen.getByRole('button', { name: '次へ' }) as HTMLButtonElement).disabled).toBe(false))
    next()
    await waitFor(() => expect(shownNode()).toBe('X0pGdw'))
    expect(calls.registrationReceipt.mock.calls.length).toBeGreaterThanOrEqual(2)
    fireEvent.click(screen.getByRole('radio', { name: /飲食店向け/ }))
    next()
    expect(shownNode()).toBe('Plmq1')
    expect(await screen.findByText('準備ができました')).toBeTruthy()
  })

  /** v07はアカウントを③で作るので、作ったあとも段の表示は⑤へ飛ばさない。 */
  it('段の表示は今いる段を指し、登録しても先へ飛ばさない', async () => {
    const current = () => screen.getByRole('navigation', { name: '登録の進捗' })
      .querySelector('[aria-current="step"]')?.textContent
    enterCheckStep()
    expect(current()).toContain('接続確認')
    await runCheck()
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))
    await screen.findByText('友だち追加できるか確かめます', { selector: 'h2' })
    expect(current()).toContain('接続確認')
    await waitFor(() => expect((screen.getByRole('button', { name: '次へ' }) as HTMLButtonElement).disabled).toBe(false))
    next()
    await waitFor(() => expect(current()).toContain('使い方を選ぶ'))
  })

  it('友だち人数があっても今回の受信が未確認なら次へ進めない', async () => {
    calls.registrationReceipt.mockResolvedValue({ success: true, data: { status: 'waiting', receivedAt: null } })
    enterCheckStep()
    await runCheck()
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))
    await screen.findByText('友だち追加できるか確かめます', { selector: 'h2' })
    await waitFor(() => expect(calls.registrationReceipt).toHaveBeenCalledWith('new-account'))
    expect(screen.getByText('接続を待っています…')).toBeTruthy()
    expect((screen.getByRole('button', { name: '次へ' }) as HTMLButtonElement).disabled).toBe(true)
    expect(shownNode()).toBe('Lwxyh')
  })

  it('受信表示の後でも押した時の再確認が未受信なら進めない', async () => {
    calls.registrationReceipt
      .mockResolvedValueOnce({ success: true, data: { status: 'confirmed', receivedAt: '2026-10-20T10:00:02.000+09:00' } })
      .mockResolvedValue({ success: true, data: { status: 'waiting', receivedAt: null } })
    enterCheckStep()
    await runCheck()
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '次へ' }) as HTMLButtonElement).disabled).toBe(false))
    next()
    await waitFor(() => expect((screen.getByRole('button', { name: '次へ' }) as HTMLButtonElement).disabled).toBe(true))
    expect(shownNode()).toBe('Lwxyh')
  })

  it('①と②も絵の正本ノードを描く', () => {
    render(<RegisterV8 />)
    expect(shownNode()).toBe('p6zMkA')
    clearPrecheck()
    expect(shownNode()).toBe('Fqy29')
  })

  /*
    手順の順番は絵の正本がすべて（利用者指示 2026-10-17）。
    `Fqy29` の `②-1 Step1 Messaging API`／`②-2 Step2 Webhook の設定`／`②-3 Step3 LINEログインの2項目`、
    戻るの行き先の名前（事前確認へ戻る→Messaging API へ戻る→Webhook の設定へ戻る）、
    `Lwxyh` Step1 の「LINEログインへ戻る」を、実際のボタン操作でたどって確かめる。
  */
  /** 出ている段は、描かれた札（Card の aria-label）で見る。 */
  const PANELS = ['Messaging API の情報を入れる', 'Webhook（受信のつなぎ）を設定する', 'LINEログインの情報を入れる'] as const
  const shownPanel = () => PANELS.find((label) => document.querySelector(`[aria-label="${label}"]`))
  const stepBadgeText = () => screen.getByText(/^Step \d \/ 3$/).textContent

  it('②は絵の正本どおり Messaging API→Webhook→LINEログイン の順に進む', () => {
    render(<RegisterV8 />)
    clearPrecheck()
    expect(stepBadgeText()).toBe('Step 1 / 3')
    expect(shownPanel()).toBe('Messaging API の情報を入れる')

    fill('v8-channel-id', '123456789')
    fill('v8-channel-secret', 'synthetic-secret')
    nextStep()
    expect(stepBadgeText()).toBe('Step 2 / 3')
    expect(shownPanel()).toBe('Webhook（受信のつなぎ）を設定する')
    expect(document.getElementById('v8-login-channel-id')).toBeNull()

    ack('Webhook URL を貼り付けて「更新」を押した')
    ack('Webhookの利用をONにした')
    ack('Webhookの再送をONにした')
    ack('エラーの統計情報をONにした')
    nextStep()
    expect(stepBadgeText()).toBe('Step 3 / 3')
    expect(shownPanel()).toBe('LINEログインの情報を入れる')
  })

  it('②の「次のステップへ」は、その段のチェックが全部入るまで押せない', () => {
    render(<RegisterV8 />)
    clearPrecheck()
    fill('v8-channel-id', '123456789')
    fill('v8-channel-secret', 'synthetic-secret')
    nextStep()
    const button = () => screen.getByRole('button', { name: '次のステップへ' }) as HTMLButtonElement
    expect(button().disabled).toBe(true)
    ack('Webhook URL を貼り付けて「更新」を押した')
    ack('Webhookの利用をONにした')
    ack('Webhookの再送をONにした')
    expect(button().disabled).toBe(true)
    ack('エラーの統計情報をONにした')
    expect(button().disabled).toBe(false)
  })

  it('戻るボタンは行き先の名前で、絵の正本の順に逆戻りする', () => {
    enterCheckStep()
    expect(shownNode()).toBe('Lwxyh')

    back('LINEログインへ戻る')
    expect(shownPanel()).toBe('LINEログインの情報を入れる')
    back('Webhook の設定へ戻る')
    expect(shownPanel()).toBe('Webhook（受信のつなぎ）を設定する')
    back('Messaging API へ戻る')
    expect(shownPanel()).toBe('Messaging API の情報を入れる')
    back('事前確認へ戻る')
    expect(shownNode()).toBe('p6zMkA')
  })

  it('③は確かめる前は5行とも待ちで、勝手に問い合わせない', () => {
    enterCheckStep()
    expect(screen.getByText('いただいた4項目で、2つのチャネルに接続できるか試します。')).toBeTruthy()
    expect(document.querySelectorAll('[data-phase="waiting"]').length).toBe(5)
    expect(calls.connectCheck).not.toHaveBeenCalled()
  })

  it('5行が通ってから登録でき、登録すると③Step2へ進む', async () => {
    enterCheckStep()
    expect(screen.queryByRole('button', { name: '登録する' })).toBeNull()
    expect(calls.connect).not.toHaveBeenCalled()
    await runCheck()
    expect(document.querySelectorAll('[data-phase="ok"]').length).toBe(5)
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))
    await waitFor(() => expect(calls.connect).toHaveBeenCalledOnce())
    expect(await screen.findByText('友だち追加できるか確かめます', { selector: 'h2' })).toBeTruthy()
  })

  it('登録後は画面から取り込みの続きを進め、完了を画面へ反映する', async () => {
    calls.connect.mockResolvedValue({ success: true, data: { ...baseData, id: 'new-account', followerImport: { capability: 'available', phase: 'importing_ids' } } })
    /* 読むだけ（followerImportState）では次の自動処理まで進まないので、画面は step を呼ぶ。 */
    calls.stepFollowerImport.mockResolvedValue({ success: true, data: { state: { capability: 'available', phase: 'completed', received: 10, imported: 10 }, busy: false, profilesFetched: 10 } })
    enterCheckStep()
    await runCheck()
    fireEvent.click(screen.getByRole('button', { name: '登録する' }))
    await screen.findByText('友だち追加できるか確かめます', { selector: 'h2' })
    await waitFor(() => expect((screen.getByRole('button', { name: '次へ' }) as HTMLButtonElement).disabled).toBe(false))
    next()
    fireEvent.click(await screen.findByRole('radio', { name: /飲食店向け/ }))
    next()
    await waitFor(() => expect(calls.stepFollowerImport).toHaveBeenCalledWith('new-account'))
    expect(calls.followerImportState).not.toHaveBeenCalled()
    expect(await screen.findByText('準備ができました')).toBeTruthy()
  })

  it('「Webhookの利用」がオフなら、その行で止めて保存しない', async () => {
    const failedSteps = passedSteps.map((step) => ({ ...step }))
    failedSteps[2] = { ...failedSteps[2], state: 'failed', message: 'LINE Developersで「Webhookの利用」をオンにしてください' }
    calls.connectCheck.mockResolvedValue({
      success: true,
      data: {
        ...baseData,
        steps: failedSteps,
        verification: {
          ...baseData.verification,
          webhook: { ...baseData.verification.webhook, active: false, testPassed: false },
        },
      },
    })
    enterCheckStep()
    fireEvent.click(screen.getByRole('button', { name: '接続を確かめる' }))
    // 行の文字は止まった時点で出るが、案内は5行の演出が終わってから出る。
    expect(await screen.findByText('「Webhookの利用」をONにしてください', {}, { timeout: 5000 })).toBeTruthy()
    const failedRow = screen.getByText('URLは登録できましたが、「Webhookの利用」がOFFのままです。上の案内のとおりONにしてください。').closest('li')
    expect(failedRow?.getAttribute('data-phase')).toBe('error')
    expect(screen.queryByRole('button', { name: '登録する' })).toBeNull()
    expect(calls.connect).not.toHaveBeenCalled()
  })
})

describe('toV8CheckRows（5行の組み立て）', () => {
  const failedAt = (order: number, message: string) =>
    passedSteps.map((step) => (step.order === order ? { ...step, state: 'failed', message } : step))

  it('検査前はすべて「まだ」', () => {
    const rows = toV8CheckRows(null)
    expect(rows).toHaveLength(5)
    expect(rows.every((row) => row.state === 'todo')).toBe(true)
    expect(allV8RowsPassed(rows)).toBe(false)
  })

  it('全部通ると5行とも通り、友だち追加URLは LINE ID から作る', () => {
    const rows = toV8CheckRows(baseData as unknown as LineAccountConnectData)
    expect(rows.every((row) => row.state === 'passed')).toBe(true)
    expect(allV8RowsPassed(rows)).toBe(true)
  })

  it('チャネルが落ちると1・2行目が止まり、保存の関所も落ちる', () => {
    const connection = {
      ...baseData,
      steps: failedAt(1, 'チャネルID・チャネルシークレットを確認してください。'),
      verification: { ...baseData.verification, tokenOk: false, sameProvider: false },
    } as unknown as LineAccountConnectData
    const rows = toV8CheckRows(connection)
    expect(rows[0].state).toBe('failed')
    expect(rows[1].state).toBe('failed')
    expect(allV8RowsPassed(rows)).toBe(false)
  })

  it('Webhook が止まると4・5行目は「まだ」のまま（3が通ると確かめる）', () => {
    const connection = {
      ...baseData,
      steps: failedAt(3, 'LINE Developersで「Webhookの利用」をオンにしてください'),
      verification: {
        ...baseData.verification,
        webhook: { ...baseData.verification.webhook, active: false, testPassed: false },
      },
    } as unknown as LineAccountConnectData
    const rows = toV8CheckRows(connection)
    expect(rows[2].state).toBe('failed')
    expect(rows[3].state).toBe('todo')
    expect(rows[4].state).toBe('todo')
    expect(allV8RowsPassed(rows)).toBe(false)
  })
})
