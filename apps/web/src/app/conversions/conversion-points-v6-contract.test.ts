import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
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

  it('口の無い期間と書き出しは、押せない形にして理由を本文に出す', () => {
    expect(PAGE).toContain('まだ繋がっていません。期間で絞る仕組みが接続されると表示されます。')
    expect(PAGE).toContain('書き出しはまだ繋がっていません。')
    // 押せない札として残さない。
    expect(PAGE).not.toContain('期間の切り替えは準備中です')
    expect(PAGE).not.toContain('書き出しは準備中です')
    expect(PAGE).not.toContain('CSVで書き出す')
  })
})
