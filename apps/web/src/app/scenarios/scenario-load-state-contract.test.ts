import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
/** 削除の確認窓は一覧側が持つ。失敗の言葉もそちらにある。 */
const LIST = readFileSync(
  new URL('../../components/scenarios/scenario-list.tsx', import.meta.url),
  'utf8',
)

describe('V6 シナリオ一覧の読込状態', () => {
  it('読込・成功・失敗を別の状態として持つ', () => {
    expect(PAGE).toContain("type LoadStatus = 'loading' | 'ready' | 'error'")
    expect(PAGE).toContain("setLoadStatus('loading')")
    expect(PAGE).toContain("setLoadStatus('ready')")
    expect(PAGE).toContain("setLoadStatus('error')")
  })

  it('読込失敗を空のシナリオ一覧として表示しない', () => {
    expect(PAGE).toContain("loadStatus === 'error'")
    expect(PAGE).toContain('登録したシナリオは消えていません。')
    expect(PAGE).toContain('シナリオを再読み込み')
    expect(PAGE).not.toContain("setError(res.error)")
  })

  it('アカウント切替前の遅い応答と古い一覧を採用しない', () => {
    expect(PAGE).toContain('const loadRequestRef = useRef(0)')
    expect(PAGE).toContain('if (requestId !== loadRequestRef.current) return')
    expect(PAGE).toContain('loadRequestRef.current += 1')
    expect(PAGE).toContain('setScenarios([])')
  })

  it('操作失敗は内部エラーを出さず一覧読込失敗と分ける', () => {
    expect(PAGE).toContain("const [actionError, setActionError] = useState('')")
    expect(PAGE).toContain('シナリオを停止できませんでした。')
    expect(PAGE).toContain('シナリオを開始できませんでした。')
    expect(PAGE).toContain('フォルダを変更できませんでした。')
    /*
      削除は確認窓へ移した（`confirm()` をやめた）。失敗しても窓を閉じずに
      その場で伝えるので、言葉は一覧側にある。ここでは**成否が返ること**を
      見る。返さないと、失敗しても窓が閉じて消えたように見える。
    */
    expect(PAGE).toContain('const handleDelete = async (id: string): Promise<boolean>')
    expect(PAGE).toContain('if (!res.success) throw new Error(res.error)')
    expect(LIST).toContain('シナリオを削除できませんでした。')
    expect(PAGE).toContain('{actionError}')
  })
})
