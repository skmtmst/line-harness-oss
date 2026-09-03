import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * V6 18-1-F `BMmxU`（空・読込・エラー）の契約。
 *
 * この画面は状態の枠が2つしか無く、**取得に失敗したときも
 * 「まだリンクがありません」と出していた。** 運用する人からは、
 * 登録したリンクが消えたように見える。3つを言い分ける。
 *
 * 併せて、素の入力欄・素の `<select disabled>`・素の前後ボタン・
 * 素のTailwind色を共通部品とV6トークンへ寄せたことも、ここで止める。
 */
describe('V6 流入経路一覧の契約', () => {
  it('空・読込・取得失敗の3状態を共通ListStateで言い分ける', () => {
    expect(PAGE).toContain('data-design-node="BMmxU"')
    expect(PAGE).toContain("import ListState from '@/components/shared/list-state'")
    expect(PAGE).toContain('<ListState kind="loading"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('kind="empty"')
    // 読み込めなかったときの言葉と、やり直す口。
    expect(PAGE).toContain('流入経路を読み込めませんでした')
    expect(PAGE).toContain('流入経路を再読み込み')
  })

  it('一覧を引けなかったことを、空と別に覚える', () => {
    expect(PAGE).toContain('const [loadFailed, setLoadFailed] = useState(false)')
    // 例外で抜けても「読み込み中」のまま固まらない。
    expect(PAGE).toContain('} catch {')
    expect(PAGE).toContain('setLoadFailed(true)')
    // 失敗を赤帯だけで流していた古い出し方は残さない。
    expect(PAGE).not.toContain("setError('リファラルリンクの取得に失敗しました')")
  })

  it('アカウント切替後の古い返事を捨て、集計未取得を0にしない', () => {
    expect(PAGE).toContain('const loadRequestRef = useRef(0)')
    expect(PAGE).toContain('requestGeneration === loadRequestRef.current')
    expect(PAGE).toContain('accountAtRequest === latestAccountRef.current')
    expect(PAGE).toContain('setRoutes([])')
    expect(PAGE).toContain('const [summaryAvailable, setSummaryAvailable] = useState(false)')
    expect(PAGE).toContain("summaryAvailable ? (r.stats?.friendCount ?? 0) : '—'")
    expect(PAGE).toContain("summaryAvailable ? (r.stats?.clickCount ?? 0) : '—'")
  })

  it('一覧型の既定値を集計成功として扱わず、画面を落とさない', () => {
    expect(PAGE).toContain('function isRefSummaryData(value: unknown): value is RefSummaryData')
    expect(PAGE).toContain('Array.isArray(candidate.routes)')
    expect(PAGE).toContain('isRefSummaryData(sum.data)')
    expect(PAGE).toContain('summary?.routes?.forEach')
  })

  it('検索・並び順・表示件数を共通部品にし、動く並び替えだけを載せる', () => {
    expect(PAGE).toContain("import SearchField from '@/components/shared/search-field'")
    expect(PAGE).toContain("import Select from '@/components/shared/select'")
    expect(PAGE).toContain('const [sort, setSort] = useState<RouteSort>')
    expect(PAGE).toContain('const [pageSize, setPageSize] = useState(20)')
    // 並び順はどれも読み込んだ行から数えられるものだけ。
    expect(PAGE).toContain('友だち追加が多い順')
    expect(PAGE).toContain('クリックが多い順')
    // 押せない見せかけの入力欄は置かない。
    // （見出しの「マニュアル」「並び替え」はこの節の担当外。
    //   `docs/design-qa/v6-media-inflow-conversion-handoff.md` に残す。）
    expect(PAGE).not.toContain('<select')
    expect(PAGE).not.toContain('表示件数の切り替えは準備中です')
  })

  it('ページ送りを共通Paginationにし、押せない前後ボタンを残さない', () => {
    expect(PAGE).toContain("import Pagination from '@/components/shared/pagination'")
    expect(PAGE).toContain('<Pagination page={page} pageCount={pageCount} onPageChange={setPage} />')
    expect(PAGE).toContain('sortedRows.slice((page - 1) * pageSize, page * pageSize)')
    expect(PAGE).not.toContain('ページの切り替えは準備中です')
  })

  it('保存した条件は作り物の札を作らず、繋がっていないと言う', () => {
    expect(PAGE).toContain("import Chip from '@/components/shared/chip'")
    expect(PAGE).toContain('まだ繋がっていません。条件の保存が接続されると表示されます。')
    expect(PAGE).not.toContain('保存した条件は準備中です')
    for (const fake of ['追加率が高い', '計測停止中']) {
      expect(PAGE, `${fake} は取れない条件なので札にしない`).not.toContain(fake)
    }
  })

  it('素のTailwind色を残さず、V6トークンで塗る', () => {
    for (const raw of [
      'emerald-600',
      'emerald-700',
      'emerald-800',
      'blue-600',
      'blue-700',
      'blue-800',
      'text-gray-800',
      'divide-gray-100',
      'divide-gray-200',
      'bg-white',
    ]) {
      expect(PAGE, `${raw} が残っています`).not.toContain(raw)
    }
    expect(PAGE).toContain('bg-accent')
    expect(PAGE).toContain('text-action')
  })
})
