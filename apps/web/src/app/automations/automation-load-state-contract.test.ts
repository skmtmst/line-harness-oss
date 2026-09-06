import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('V6 オートメーション一覧の状態', () => {
  it('読込・成功・失敗を別の状態として持つ', () => {
    expect(PAGE).toContain("type LoadStatus = 'loading' | 'ready' | 'error'")
    expect(PAGE).toContain("const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')")
    expect(PAGE).toContain("setLoadStatus('ready')")
    expect(PAGE).toContain("setLoadStatus('error')")
  })

  it('失敗時に古い一覧を現在値として残さない', () => {
    expect(PAGE.match(/setAutomations\(\[\]\)\n\s+setLoadStatus\('error'\)/g)).toHaveLength(2)
  })

  it('失敗を0件や作成誘導に見せず、再読み込みできる', () => {
    const errorBranch = PAGE.indexOf("loadStatus === 'error'")
    const emptyBranch = PAGE.indexOf("visibleAutomations.length === 0 && !showCreate")
    expect(errorBranch).toBeGreaterThan(-1)
    expect(emptyBranch).toBeGreaterThan(errorBranch)
    expect(PAGE).toContain('登録したルールは消えていません。')
    expect(PAGE).toContain('onClick={() => void loadAutomations()}')
  })

  it('未取得の件数を0件として表示しない', () => {
    expect(PAGE).toContain("loadStatus === 'ready' ? automations.filter((item) => item.isActive).length : null")
    expect(PAGE).toContain("estimatedHoursSaved !== null")
    expect(PAGE).toContain("失敗回数の集計口が必要です")
  })

  it('分析の使われ方から30日の実行と削減時間を読む', () => {
    expect(PAGE).toContain('api.analytics.usageOverview(selectedAccountId)')
    expect(PAGE).toContain('usage?.automaticRuns.value ?? null')
    expect(PAGE).toContain('usage?.estimatedHoursSaved.value ?? null')
    expect(PAGE).toContain('1回30秒として計算しています')
  })

  it('空の状態を共通部品とdata-list-stateで見分けられる', () => {
    expect(PAGE).toContain('<ListState')
    expect(PAGE).toContain('動いているオートメーションはありません。')
    expect(PAGE).toContain('きっかけ・だれに・することの3つを決めると動きます。')
  })

  it('アカウント切替前の遅い応答を採用しない', () => {
    expect(PAGE).toContain('const loadRequestRef = useRef(0)')
    expect(PAGE).toContain('if (requestId !== loadRequestRef.current) return')
    expect(PAGE).toContain('loadRequestRef.current += 1')
  })
})
