// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RegisterV8, { allV8RowsPassed, toV8CheckRows } from './register-v8'
import type { LineAccountConnectData } from '@/lib/api'

const calls = vi.hoisted(() => ({
  connectCheck: vi.fn(), connect: vi.fn(), list: vi.fn(),
  followerImportState: vi.fn(), followerInsight: vi.fn(),
  staffList: vi.fn(), tagList: vi.fn(), tagCreate: vi.fn(), tagSet: vi.fn(),
}))
vi.mock('@/lib/api', () => ({
  api: {
    lineAccounts: {
      connectCheck: calls.connectCheck,
      connect: calls.connect,
      list: calls.list,
      followerImportState: calls.followerImportState,
      followerInsight: calls.followerInsight,
    },
    staff: { list: calls.staffList },
    lineAccountTags: { list: calls.tagList, create: calls.tagCreate, setForAccount: calls.tagSet },
  },
}))
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
  calls.staffList.mockResolvedValue({ success: true, data: [] })
  calls.tagList.mockResolvedValue({ success: true, data: [] })
  calls.followerInsight.mockResolvedValue({ success: true, data: { followers: null } })
})

const fill = (id: string, value: string) => fireEvent.change(document.getElementById(id)!, { target: { value } })
const next = () => fireEvent.click(screen.getByRole('button', { name: '次へ' }))

async function enterCheckStep() {
  render(<RegisterV8 />)
  next()
  fill('v8-channel-id', '123456789')
  fill('v8-channel-secret', 'synthetic-secret')
  fill('v8-login-channel-id', '2007123456')
  fill('v8-login-channel-secret', 'synthetic-login-secret')
  next()
  next()
  expect(await screen.findByRole('button', { name: '接続して設定する' })).toBeTruthy()
}

describe('V8 登録ウィザードの gated 進行', () => {
  it('②の4項目が空では③へ進めない', async () => {
    render(<RegisterV8 />)
    next()
    next()
    expect(screen.getByText('チャネルIDを入力してください。')).toBeTruthy()
    expect(screen.queryByText('LINE ID')).toBeNull()
  })

  it('④は検査前は5行とも「まだ」', async () => {
    await enterCheckStep()
    expect(screen.getAllByText('まだ').length).toBeGreaterThanOrEqual(5)
    expect(calls.connectCheck).not.toHaveBeenCalled()
  })

  it('検査が通ると結果の窓が開き、手動の1行と確認ボタンが出る', async () => {
    await enterCheckStep()
    fireEvent.click(screen.getByRole('button', { name: '接続して設定する' }))
    expect(await screen.findByText('接続を確かめた結果')).toBeTruthy()
    expect(screen.getByText('応答メッセージ')).toBeTruthy()
    expect(screen.getByRole('button', { name: '確認コードを入れて登録する' })).toBeTruthy()
  })

  it('手動のチェックが無いと登録ボタンは押せない。入れると登録して⑤へ進む', async () => {
    await enterCheckStep()
    fireEvent.click(screen.getByRole('button', { name: '接続して設定する' }))
    const registerButton = await screen.findByRole('button', { name: '確認コードを入れて登録する' })
    expect((registerButton as HTMLButtonElement).disabled).toBe(true)
    expect(calls.connect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('LINE Official Account Manager で「応答メッセージ」をオフにしたことを確かめました'))
    expect((registerButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(registerButton)
    await waitFor(() => expect(calls.connect).toHaveBeenCalledOnce())
    expect(await screen.findByText('登録が完了しました')).toBeTruthy()
  })

  it('登録後はWorkerで進む取り込みを読み取り、完了を画面へ反映する', async () => {
    calls.connect.mockResolvedValue({ success: true, data: { ...baseData, id: 'new-account', followerImport: { capability: 'available', phase: 'importing_ids' } } })
    calls.followerImportState.mockResolvedValue({ success: true, data: { capability: 'available', phase: 'hydrating_profiles', received: 10, imported: 10 } })
    await enterCheckStep()
    fireEvent.click(screen.getByRole('button', { name: '接続して設定する' }))
    const registerButton = await screen.findByRole('button', { name: '確認コードを入れて登録する' })
    fireEvent.click(screen.getByText('LINE Official Account Manager で「応答メッセージ」をオフにしたことを確かめました'))
    fireEvent.click(registerButton)
    await waitFor(() => expect(calls.followerImportState).toHaveBeenCalledWith('new-account'))
    expect(await screen.findByText('登録が完了しました')).toBeTruthy()
  })

  it('止まった項目があると窓は開かず保存もしない', async () => {
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
    await enterCheckStep()
    fireEvent.click(screen.getByRole('button', { name: '接続して設定する' }))
    expect(await screen.findByText('止まった項目を直して、もう一度「接続して設定する」を押してください。')).toBeTruthy()
    expect(screen.queryByText('接続を確かめた結果')).toBeNull()
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
