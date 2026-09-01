import { describe, expect, it } from 'vitest'
import {
  audienceText,
  blockedReason,
  canPublish,
  idempotencyKeyFor,
  monitoringLink,
  NOT_AVAILABLE,
  testResultText,
} from './publish-flow'

const check = (key: string, status: 'passed' | 'warning' | 'failed', label = key) =>
  ({ key, label, status, detail: '' }) as never

const validation = (over: Record<string, unknown> = {}) => ({
  canPublish: true,
  estimatedAudienceCount: 214,
  checks: [check('first_time', 'passed'), check('actions', 'passed')],
  conflicts: [],
  lastTestStatus: 'succeeded' as const,
  ...over,
}) as never

describe('対象見込み', () => {
  it('未取得を0人にしない', () => {
    // 公開前は validation の値を使う。公開後の返事や設計の数字を先取りしない。
    expect(audienceText(null)).toBe(NOT_AVAILABLE)
    expect(audienceText(undefined)).toBe(NOT_AVAILABLE)
    expect(audienceText(0)).toBe('0人')
    expect(audienceText(214)).toBe('214人')
    expect(audienceText(12345)).toBe('12,345人')
  })
})

describe('公開してよいか', () => {
  it('確認が済み、テストが成功していれば押せる', () => {
    expect(canPublish({ validation: validation(), busy: false })).toBe(true)
  })

  it('テストが成功していなければ押せない', () => {
    /*
     * `canPublish` だけに頼ると、**試験していない下書きを公開できる形**に
     * なり得る。引き継ぎの2番はこの2つを別々に要求している。
     */
    expect(canPublish({ validation: validation({ lastTestStatus: null }), busy: false })).toBe(false)
    expect(canPublish({ validation: validation({ lastTestStatus: 'failed' }), busy: false })).toBe(false)
  })

  it('Workerが止めていれば押せない', () => {
    expect(canPublish({ validation: validation({ canPublish: false }), busy: false })).toBe(false)
  })

  it('読み込めていないときと送信中は押せない', () => {
    expect(canPublish({ validation: null, busy: false })).toBe(false)
    expect(canPublish({ validation: validation(), busy: true })).toBe(false)
  })
})

describe('押せない理由', () => {
  it('テストの状態で言い分ける', () => {
    expect(blockedReason(validation({ lastTestStatus: null }))).toContain('テスト送信がまだです')
    expect(blockedReason(validation({ lastTestStatus: 'failed' }))).toContain('失敗しています')
  })

  it('直すべき項目を名前で言う', () => {
    const v = validation({
      canPublish: false,
      checks: [check('actions', 'failed', 'アクション'), check('first_time', 'passed', '初回')],
    })
    expect(blockedReason(v)).toBe('アクションを直してください。')
  })

  it('押せるときは理由を出さない', () => {
    expect(blockedReason(validation())).toBeNull()
  })

  it('内部の記号を出さない', () => {
    for (const v of [null, validation({ lastTestStatus: null }), validation({ canPublish: false })]) {
      expect(blockedReason(v) ?? '').not.toMatch(/[a-z_]{4,}/)
    }
  })
})

describe('テストの結果', () => {
  it('dry-runを「送信済み」と書かない', () => {
    const text = testResultText({
      kind: 'first_time', scenarioName: '友だち挨拶', suppressed: false, actionCount: 2,
    })
    expect(text).toContain('実際の送信・登録・タグ付けはしていません')
    expect(text).not.toContain('送信済み')
    expect(text).not.toContain('反映済み')
  })

  it('対象外のときも、送っていないことを言う', () => {
    const text = testResultText({ kind: 'returning', scenarioName: null, suppressed: true, actionCount: 0 })
    expect(text).toContain('対象外')
    expect(text).toContain('実際の送信はしていません')
  })

  it('シナリオ名が無ければ「—（未取得）」', () => {
    const text = testResultText({ kind: 'first_time', scenarioName: null, suppressed: false, actionCount: 1 })
    expect(text).toContain(NOT_AVAILABLE)
  })
})

describe('実行結果への導線', () => {
  it('つながっていないときはリンクにしない', () => {
    // 無い画面へ送ると404になる。
    const link = monitoringLink({
      monitoringPath: null, monitoringUnavailableReason: '実行結果はまだ接続していません',
    } as never)
    expect(link.href).toBeNull()
    expect(link.note).toBe('実行結果はまだ接続していません')
  })

  it('つながっていればリンクにする', () => {
    const link = monitoringLink({
      monitoringPath: '/friend-add-settings/runs', monitoringUnavailableReason: null,
    } as never)
    expect(link.href).toBe('/friend-add-settings/runs')
  })
})

describe('二重に公開しない鍵', () => {
  it('同じ下書きなら同じ鍵になる', () => {
    const version = { accountId: 'acc-1', versionId: 'v-9' } as never
    expect(idempotencyKeyFor(version)).toBe(idempotencyKeyFor(version))
  })

  it('16文字以上にする', () => {
    // Workerが16文字未満を受け取らない。
    expect(idempotencyKeyFor({ accountId: 'a', versionId: 'b' } as never).length).toBeGreaterThanOrEqual(16)
  })

  it('別の版なら別の鍵になる', () => {
    const a = idempotencyKeyFor({ accountId: 'acc-1', versionId: 'v-1' } as never)
    const b = idempotencyKeyFor({ accountId: 'acc-1', versionId: 'v-2' } as never)
    expect(a).not.toBe(b)
  })
})
