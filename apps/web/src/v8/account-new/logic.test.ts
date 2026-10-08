import { describe, expect, it } from 'vitest'
import type { LineAccountConnectData } from '@/lib/api'
import { DRAFT_KEY, allV8RowsPassed, checkRowText, readDraft, toV8CheckRows } from './logic'

const storage = (value: unknown) => ({ getItem: (key: string) => key === DRAFT_KEY ? JSON.stringify(value) : null })
const connection = (webhook: 'passed' | 'failed'): LineAccountConnectData => ({
  steps: [1, 2, 3, 4, 5].map((order) => ({ order: order as 1, message: `段${order}`, state: order === 3 ? webhook : 'passed' })),
  verification: { tokenOk: true, loginOk: true, sameProvider: true, webhook: { expectedUrl: 'https://x/webhook', registeredUrl: 'https://x/webhook', active: webhook === 'passed', testPassed: webhook === 'passed' }, followerTotal: 3 },
  pictureUrl: null, basicId: '@nen', followerImport: { capability: 'available', phase: 'not_started' }, remainingActions: [],
})

describe('LINEアカウントを登録（★V8）の小さな計算', () => {
  it('手順1のまま何も入れていない下書きは戻さない（開き直しただけで「下書きから続けます」を出さない）', () => {
    expect(readDraft(storage({ step: 1, accountMethod: 'existing', name: '', channelId: '', loginChannelId: '', lineId: '', tagIds: [], parentId: '', staffIds: [], liffId: '', importFriends: true }))).toBeNull()
  })

  it('中身のある下書きは戻す（秘密値の欄は持たない）', () => {
    const draft = readDraft(storage({ step: 2, accountMethod: 'existing', name: '', channelId: '2001', channelSecret: 'secret', loginChannelId: '', lineId: '', tagIds: [], parentId: '', staffIds: [], liffId: '', importFriends: true }))
    expect(draft).toMatchObject({ step: 2, channelId: '2001' })
    expect(draft && 'channelSecret' in draft).toBe(false)
    expect(readDraft(storage({ step: 1, accountMethod: 'new' }))).toMatchObject({ accountMethod: 'new' })
  })

  it('④の5行：検査前はすべて「まだ」、Webhook が止まれば4・5行目は「まだ」のまま、全部通れば保存できる', () => {
    expect(toV8CheckRows(null).map((row) => row.state)).toEqual(['todo', 'todo', 'todo', 'todo', 'todo'])
    const stopped = toV8CheckRows(connection('failed'))
    expect(stopped.map((row) => row.state)).toEqual(['passed', 'passed', 'failed', 'todo', 'todo'])
    expect(stopped[2].detail).toContain('「Webhook の利用」がオフです')
    expect(allV8RowsPassed(stopped)).toBe(false)
    const passed = toV8CheckRows(connection('passed'))
    expect(allV8RowsPassed(passed)).toBe(true)
    expect(passed[4].detail).toBe('https://lin.ee/nen')
  })

  it('④の止まった行は理由を1つだけ出す（Webhook のオフの説明に段の文を重ねない）', () => {
    const stopped = toV8CheckRows(connection('failed'))
    expect(checkRowText(stopped[2])).toBe('LINE Developers で「Webhook の利用」がオフです。オンにしてから押し直してください')
    expect(checkRowText(stopped[2])).not.toContain('段3')
    const noDetail = toV8CheckRows({ ...connection('failed'), verification: undefined })
    expect(checkRowText(noDetail[2])).toBe('受け口へ届きませんでした（段3）')
    expect(checkRowText(stopped[0])).toBe('Messaging API・LINE Login とも認証済み')
  })
})
