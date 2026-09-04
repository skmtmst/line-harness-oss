import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('V6 友だち一覧の読込状態', () => {
  it('読込・成功・失敗を別の状態として持つ', () => {
    expect(PAGE).toContain("type LoadStatus = 'loading' | 'ready' | 'error'")
    expect(PAGE).toContain("setLoadStatus('loading')")
    expect(PAGE).toContain("setLoadStatus('ready')")
    expect(PAGE).toContain("setLoadStatus('error')")
  })

  it('読込失敗を0件の友だち一覧として表示しない', () => {
    expect(PAGE).toContain("loadStatus === 'error'")
    expect(PAGE).toContain('登録した友だちは消えていません。')
    expect(PAGE).toContain('onRetry={() => void loadFriends()}')
    expect(PAGE).not.toContain('setError(response.error)')
  })

  it('未取得の件数を0件にせずCSVも止める', () => {
    expect(PAGE).toContain("loadStatus === 'ready' ? `${total.toLocaleString('ja-JP')}件` : '—'")
    expect(PAGE).toContain("onExportReady(loadStatus === 'ready' ? exportCurrentPage : null)")
    expect(PAGE).toContain('disabled={!exportCurrentPage}')
  })

  it('条件変更前の遅い応答と古い一覧を採用しない', () => {
    expect(PAGE).toContain('const loadRequestRef = useRef(0)')
    expect(PAGE).toContain('if (requestId !== loadRequestRef.current) return')
    expect(PAGE).toContain('loadRequestRef.current += 1')
    expect(PAGE).toContain('setFriends([])')
  })
})
