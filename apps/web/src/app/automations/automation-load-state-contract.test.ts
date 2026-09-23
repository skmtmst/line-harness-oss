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
    expect(PAGE.match(/setAutomations\(\[\]\)/g)).toHaveLength(2)
    expect(PAGE.match(/setLoadStatus\('error'\)/g)).toHaveLength(2)
  })

  it('失敗を0件や作成誘導に見せず、再読み込みできる', () => {
    const errorBranch = PAGE.indexOf("loadStatus === 'error'")
    const emptyBranch = PAGE.indexOf('visibleAutomations.length === 0 ? (')
    expect(errorBranch).toBeGreaterThan(-1)
    expect(emptyBranch).toBeGreaterThan(errorBranch)
    expect(PAGE).toContain('登録したルールは消えていません。')
    expect(PAGE).toContain('onClick={() => void loadAutomations()}')
  })

  it('未取得の件数を0件として表示しない', () => {
    expect(PAGE).toContain("loadStatus === 'ready' ? automations.filter((item) => item.isActive).length : null")
    // 監査6 #674: 未取得は null のまま MetricValue へ渡し、「—」と0を区別する
    expect(PAGE).toContain('<MetricValue value={estimatedHoursSaved}')
    expect(PAGE).toContain('<MetricValue value={failedRuns ?? null}')
  })

  it('一覧契約の集計から30日の実行・失敗と削減時間を読む', () => {
    expect(PAGE).toContain('res.summary?.executionCount30d ?? null')
    expect(PAGE).toContain('res.summary?.failureCount30d ?? null')
    expect(PAGE).toContain('Math.round(executions / 120)')
    expect(PAGE).toContain('1回30秒として計算しています')
  })

  it('各行の実行回数・失敗回数と詳細導線を表示する', () => {
    expect(PAGE).toContain("automation.executionCount30d.toLocaleString('ja-JP')")
    expect(PAGE).toContain('automation.failureCount30d > 0')
    // #942 N-352: 編集は公開版を写した下書きを作ってから開く。実行記録への
    // 導線は行の名前を検索語に載せる。
    expect(PAGE).toContain('api.automations.createDraftFromAutomation(')
    expect(PAGE).toContain('router.push(`/automations/drafts?id=')
    expect(PAGE).toContain('href={`/automations/runs?search=')
  })

  it('編集用の下書きを作れなかった理由を失敗の種類で分ける（AUTOMATION-05）', () => {
    /*
     * 「編集する」の失敗を1文にまとめると、権限不足・消えたルール・
     * 他者の変更・通信切れを区別できない。403/404/409/それ以外で
     * 運用者の案内を分け、404・409は一覧を読み直す。
     */
    expect(PAGE).toContain('describeAutomationEditFailure')
    expect(PAGE).toContain('このルールを編集する権限がありません')
    expect(PAGE).toContain('ルールが見つかりませんでした')
    expect(PAGE).toContain('ほかの人の変更と重なりました')
    expect(PAGE).toContain('サーバー側で編集用の下書きを作れませんでした')
    expect(PAGE).toContain('通信状態を確かめて')
    expect(PAGE).toContain('setError(describeAutomationEditFailure(caught))')
    // 404・409 は一覧が古い可能性があるので読み直す。
    expect(PAGE).toContain('caught.status === 404 || caught.status === 409')
    expect(PAGE).toContain('void loadAutomations()')
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

  it('到達不能だった旧作成フォームを持たない（#554 点検#519中6）', () => {
    expect(PAGE).not.toContain('showCreate')
    expect(PAGE).not.toContain('handleCreate')
    expect(PAGE).not.toContain('automations.create(')
    expect(PAGE).not.toContain('新規オートメーションを作成')
    // #942 N-352: 稼働切替と「保管」はV6の定義ステータス遷移で行う。
    // 削除は保管に置き換わり、旧 PUT/DELETE には接続しない。
    expect(PAGE).toContain('api.automations.setStatus(')
    expect(PAGE).toContain("'archived'")
    expect(PAGE).not.toContain('api.automations.update(')
    expect(PAGE).not.toContain('api.automations.delete(')
  })

  it('「動いた回数が多い順」は30日実績で並べる（#554 点検#519中8）', () => {
    expect(PAGE).toContain('b.executionCount30d - a.executionCount30d')
  })

  it('ページ送りは操作でき、7件目以降へ行ける（#554 点検#519中1・中9）', () => {
    expect(PAGE).toContain('pagedAutomations')
    expect(PAGE).toContain('aria-label="ページ送り"')
    expect(PAGE).toContain('setPage(currentPage - 1)')
    expect(PAGE).toContain('setPage(currentPage + 1)')
    expect(PAGE).toContain('本中')
    expect(PAGE).not.toContain('slice(0, 6)')
    expect(PAGE).not.toContain('2　3　次へ')
  })
})
