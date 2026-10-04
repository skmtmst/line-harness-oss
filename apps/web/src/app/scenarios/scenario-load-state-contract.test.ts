import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

/* 完全切り替え：v7 の page.tsx は捨て、V8 の list-v8.tsx を見る。 */
const PAGE = readFileSync(new URL('./list-v8.tsx', import.meta.url), 'utf8')

describe('V6 シナリオ一覧の読込状態', () => {
  it('読込・成功・失敗を別の状態として持つ', () => {
    expect(PAGE).toContain('useOffsetServerList<ScenarioRow>')
    expect(PAGE).toContain('scenarioList.loading')
    expect(PAGE).toContain('scenarioList.error')
    expect(PAGE).toContain('scenarioList.items')
  })

  it('読込失敗を空のシナリオ一覧として表示しない', () => {
    expect(PAGE).toContain('scenarioList.error')
    /* 板 `BxGhV`「読み込めなかった」：細い帯＋もう一度試す。 */
    expect(PAGE).toContain('シナリオを読み込めませんでした')
    expect(PAGE).toContain('>もう一度試す<')
    expect(PAGE).toContain('onClick={() => void loadScenarios()}')
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
    expect(PAGE).toContain('件の停止ができませんでした')
    expect(PAGE).toContain('件の開始ができませんでした')
    expect(PAGE).toContain('フォルダを移動できませんでした')
    expect(PAGE).toContain('このシナリオを削除できませんでした')
    expect(PAGE).toContain('{actionError}')
  })
})
