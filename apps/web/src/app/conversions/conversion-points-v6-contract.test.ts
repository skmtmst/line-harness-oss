import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const NEW_PAGE = readFileSync(new URL('./new/page.tsx', import.meta.url), 'utf8')
const STRUCTURE = readFileSync(new URL('../../lib/design-structure.json', import.meta.url), 'utf8')

/**
 * V6 19-1 成果地点（`/conversions?tab=points`）の契約。
 *
 * `nodeByTab` に `points` と `report` が無く、**`data-design-node={undefined}`
 * がそのまま出ていた。** 設計と実装を突き合わせる手掛かりが消えるので、
 * 5タブぶんすべてを埋める。
 *
 * 併せて、押せない検索・並び順・期間・書き出し・前後ボタンを、
 * 動く共通部品か「繋がっていない」の言葉のどちらかにする。
 */
describe('V6 成果地点一覧の契約', () => {
  it('5タブすべてにV6実Nodeを付ける', () => {
    expect(PAGE).toContain("points: 'ZrpKn',")
    expect(PAGE).toContain("report: 'GUxsj',")
    // 設計側の並びは design-structure.json に記録がある。
    expect(STRUCTURE).toContain('"node": "PouPn GH8VL n5VVTb ZrpKn GUxsj"')
    // `d8d3Mz` は削除確認の重ね画面。一覧のNodeとして使わない。
    expect(PAGE).not.toContain("points: 'd8d3Mz'")
    expect(PAGE).not.toContain('data-design-node="d8d3Mz"')
  })

  it('空・読込・取得失敗の3状態を共通ListStateで言い分ける', () => {
    expect(PAGE).toContain("import ListState from '@/components/shared/list-state'")
    expect(PAGE).toContain('<ListState kind="loading"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('kind="empty"')
    expect(PAGE).toContain('成果地点を読み込めませんでした')
    expect(PAGE).toContain('成果地点を再読み込み')
    expect(PAGE).toContain('const [loadFailed, setLoadFailed] = useState(false)')
  })

  it('集計を取得できないときは成果数を0件にしない', () => {
    expect(PAGE).toContain('const [reportAvailable, setReportAvailable] = useState(false)')
    expect(PAGE).toContain('setReportAvailable(false)')
    expect(PAGE).toContain("reportAvailable ? `${(countByPoint.get(point.id) ?? 0).toLocaleString()}件` : '—'")
  })

  it('一覧でない返事を成功扱いせず、前の集計も残さない', () => {
    for (const reset of ['setPoints([])', 'setReport([])', 'setPreviousReport([])']) {
      expect(PAGE).toContain(reset)
    }
    expect(PAGE.match(/Array\.isArray\(/g)?.length).toBeGreaterThanOrEqual(5)
  })

  it('検索と並び順を共通部品にし、数えられる並びだけを載せる', () => {
    expect(PAGE).toContain("import SearchField from '@/components/shared/search-field'")
    expect(PAGE).toContain("import Select from '@/components/shared/select'")
    expect(PAGE).toContain('const [sort, setSort] = useState<PointSort>')
    expect(PAGE).toContain('CV数が多い順')
    expect(PAGE).not.toContain('並び替えは準備中です')
  })

  it('ページ送りを共通Paginationにする', () => {
    expect(PAGE).toContain("import Pagination from '@/components/shared/pagination'")
    expect(PAGE).toContain('<Pagination page={page} pageCount={pageCount} onPageChange={setPage} />')
    expect(PAGE).toContain('shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)')
    expect(PAGE).not.toContain('ページの切り替えは準備中です')
  })

  it('期間は実際の集計口へつなぎ、口の無い書き出しは理由を本文に出す', () => {
    expect(PAGE).toContain('api.conversions.report(reportRange(30))')
    expect(PAGE).toContain('api.conversions.report(reportRange(periodDays))')
    expect(PAGE).toContain("{ value: '30', label: 'この30日' }")
    expect(PAGE).toContain('書き出しはまだ繋がっていません。')
    expect(PAGE).toContain('CSVの書き出し口は未接続です。')
    expect(PAGE).not.toContain('準備中')
  })

  it('一覧とレポートを別の運用目的で表示する', () => {
    for (const text of ['何が起きたら数えるか', '使われている場所', '利用先の取得は未接続']) {
      expect(PAGE).toContain(text)
    }
    for (const text of ['日ごとの成果', '前の期間', '増減', 'いちばん多い経路']) {
      expect(PAGE).toContain(text)
    }
    expect(PAGE).toContain('日別の集計口はまだ接続されていません。')
    expect(PAGE).toContain('帰属根拠の集計は未接続')
  })

  it('作成画面で重複を止め、試算口の未接続を隠さない', () => {
    expect(NEW_PAGE).toContain('designNode="GtylA"')
    expect(NEW_PAGE).toContain('variant="v6"')
    expect(NEW_PAGE).toContain('const duplicateName = useMemo')
    expect(NEW_PAGE).toContain('同じ意味の成果地点を2つ作らないでください')
    expect(NEW_PAGE).toContain('保存前の試算口はまだ接続されていません。')
    expect(NEW_PAGE).not.toContain('準備中')
    expect(NEW_PAGE).not.toContain('Webhookで受け取った')
  })
})
