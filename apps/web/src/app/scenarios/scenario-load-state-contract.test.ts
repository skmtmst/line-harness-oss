import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('V6 シナリオ一覧の読込状態', () => {
  it('読込・成功・失敗を別の状態として持つ', () => {
    expect(PAGE).toContain('useOffsetServerList<ScenarioWithCount>')
    expect(PAGE).toContain('scenarioList.loading')
    expect(PAGE).toContain('scenarioList.error')
    expect(PAGE).toContain('scenarioList.items')
  })

  it('読込失敗を空のシナリオ一覧として表示しない', () => {
    expect(PAGE).toContain('scenarioList.error')
    expect(PAGE).toContain('登録したシナリオは消えていません。')
    expect(PAGE).toContain('onRetry={() => void loadScenarios()}')
    expect(PAGE).not.toContain("setError(res.error)")
  })

  it('アカウント切替前の遅い応答と古い一覧を採用しない', () => {
    expect(PAGE).toContain('requestKey: JSON.stringify({')
    expect(PAGE).toContain("accountId: selectedAccountId ?? ''")
    expect(PAGE).toContain('}, signal)')
    expect(PAGE).toContain('page: request.page')
  })

  it('操作失敗は内部エラーを出さず一覧読込失敗と分ける', () => {
    expect(PAGE).toContain("const [actionError, setActionError] = useState('')")
    expect(PAGE).toContain('シナリオを停止できませんでした。')
    expect(PAGE).toContain('シナリオを開始できませんでした。')
    expect(PAGE).toContain('フォルダを変更できませんでした。')
    expect(PAGE).toContain('シナリオを削除できませんでした。')
    expect(PAGE).toContain('{actionError}')
  })
})
