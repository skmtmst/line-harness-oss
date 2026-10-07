import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
// 「まとめて操作」の窓は v7・V8 の両方で使う共用部品へ移した（中身は同じ）。
// まとめて操作の窓は一覧の画面（page.tsx）の中にある。古い _components/bulk-routes-dialog.tsx はどこからも描かれないので 2026-10-07 に消した。
const BULK = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * 流入と計測の一覧（板 xbHxg）の契約。
 *
 * 空・読込・取得失敗の3つを言い分ける。素の入力欄・素の `<select>`・
 * 素の前後ボタン・素のTailwind色を共通部品とトークンへ寄せたことも、
 * ここで止める。
 */
describe('V6 流入経路一覧の契約', () => {
  it('共通フォルダ欄の統一幅を使い、追加ボタンを欄内だけに置く', () => {
    expect(PAGE).toContain('style={FOLDER_RAIL_STYLE}')
    expect(PAGE).toContain('styles.columns')
    expect(PAGE).not.toContain('選ぶと右側のリンクが切り替わります')
    expect(PAGE).toContain("onAddFolder={readonly ? undefined : () => setEditingGenre('new')}")
    // EMUl9: 閲覧のみは追加の口を渡さない（欄内の追加印も出ない）。
    expect(PAGE).not.toMatch(/<Button[^>]*>フォルダを追加<\/Button>/)
  })

  it('空・読込・取得失敗の3状態を共通ListStateで言い分ける', () => {
    expect(PAGE).toContain("import ListState from '@/components/shared/list-state'")
    expect(PAGE).toContain('<ListState kind="loading"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('kind="empty"')
    // M029: 原因をそのまま渡す。403は権限の案内・再試行なし、
    // 429は待ち案内つきで再試行あり（m23mの共通文）。
    expect(PAGE).toContain("import { loadFailureCopy } from '@/components/shared/api-error-message'")
    expect(PAGE).toContain("loadFailureCopy(loadError, '流入経路')")
    expect(PAGE).toContain('error={loadError ?? undefined}')
    expect(PAGE).toContain('onRetry={loadFailure?.retryable ? () => void load() : undefined}')
    // 通らない再試行を促す一律の文・ボタンは残さない。
    expect(PAGE).not.toContain('流入経路を読み込めませんでした')
    expect(PAGE).not.toContain('流入経路を再読み込み')
  })

  it('一覧を引けなかったことを、空と別に覚える', () => {
    expect(PAGE).toContain('const [loadFailed, setLoadFailed] = useState(false)')
    // 例外で抜けても「読み込み中」のまま固まらない。
    expect(PAGE).toContain('} catch (e) {')
    expect(PAGE).toContain('setLoadFailed(true)')
    // M029: 原因も残し、403・429を言い分ける。
    expect(PAGE).toContain('const [loadError, setLoadError] = useState<unknown>(null)')
    expect(PAGE).toContain('setLoadError(e)')
    // 失敗を赤帯だけで流していた古い出し方は残さない。
    expect(PAGE).not.toContain("setError('リファラルリンクの取得に失敗しました')")
  })

  it('アカウント切替後の古い返事を捨て、集計未取得を0にしない', () => {
    expect(PAGE).toContain('const loadRequestRef = useRef(0)')
    expect(PAGE).toContain('requestGeneration === loadRequestRef.current')
    expect(PAGE).toContain('accountAtRequest === latestAccountRef.current')
    expect(PAGE).toContain('setRoutes([])')
    expect(PAGE).toContain('const [summaryAvailable, setSummaryAvailable] = useState(false)')
    expect(PAGE).toContain("summaryAvailable && r.stats ? (")
    expect(PAGE).toContain("summaryAvailable && r.stats ? formatNumber(r.stats.clickCount) : '—'")
  })

  it('一覧型の既定値を集計成功として扱わず、画面を落とさない', () => {
    expect(PAGE).toContain('function isRefSummaryData(value: unknown): value is RefSummaryData')
    expect(PAGE).toContain('Array.isArray(candidate.routes)')
    expect(PAGE).toContain('isRefSummaryData(sum.data)')
    expect(PAGE).toContain('summary?.routes?.forEach')
  })

  it('検索・並び順・表示件数を共通部品にし、動く並び替えだけを載せる', () => {
    // 板 xbHxg：検索は共通 SearchField をそのまま置く。素の input 検索に戻さない。
    expect(PAGE).toContain("import SearchField from '@/components/shared/search-field'")
    expect(PAGE).toContain('<SearchField')
    expect(PAGE).toContain("import Select from '@/components/shared/select'")
    expect(PAGE).toContain("import PageSizeSelect from '@/components/ui/page-size-select'")
    expect(PAGE).toContain('const [sort, setSort] = useState<RouteSort>')
    expect(PAGE).toContain('const [pageSize, setPageSize] = useState(20)')
    // 並び順はどれも読み込んだ行から数えられるものだけ。
    expect(PAGE).toContain('友だち追加が多い順')
    expect(PAGE).toContain('クリックが多い順')
    // 押せない見せかけの入力欄は置かない。
    expect(PAGE).not.toContain('<select')
    expect(PAGE).not.toContain('表示件数の切り替えは準備中です')
  })

  it('ページ送りを共通Paginationにし、押せない前後ボタンを残さない', () => {
    expect(PAGE).toContain("import Pagination from '@/components/shared/pagination'")
    expect(PAGE).toContain('<Pagination page={page} pageCount={pageCount} onPageChange={setPage} />')
    expect(PAGE).toContain('sortedRows.slice((page - 1) * pageSize, page * pageSize)')
    expect(PAGE).not.toContain('ページの切り替えは準備中です')
  })

  it('保存した条件は作り物の札も「未接続」の行も出さない（★V7）', () => {
    // 押せない札も「まだ繋がっていません」の行も、運用する人には使えない表示。
    // 条件の保存が接続されるまでは何も出さない。
    expect(PAGE).not.toContain('data-design="Saved"')
    expect(PAGE).not.toContain('保存した条件は準備中です')
    for (const fake of ['追加率が高い', '計測停止中']) {
      expect(PAGE, `${fake} は取れない条件なので札にしない`).not.toContain(fake)
    }
  })

  it('行一覧の組み立ては描画ごとに作り直さない', () => {
    expect(PAGE).toContain('const rowsByRef = useMemo(')
  })

  it('コピーの失敗を無言にしない', () => {
    expect(PAGE).toContain('コピー失敗')
    expect(PAGE).not.toContain('// silent')
  })

  it('まとめて操作は対象選択→操作→影響件数の確認へ接続する（NEXT-21）', () => {
    expect(PAGE).toContain('setBulkOpen(true)')
    // ★V7：選択は共通のチェックボックス（本物の checkbox を包んでいる）。
    expect(PAGE).toContain('<Checkbox')
    expect(PAGE).toContain('selectedRouteIds')
    // 実行は既存の更新口へ、1件ずつ結果を分けて出す（共用部品の中身）。
    expect(BULK).toContain('api.entryRoutes.update(route.id')
    expect(BULK).toContain('件に実行する')
    expect(BULK).toContain('は実行できませんでした')
  })

  it('素のTailwind色を残さず、トークンで塗る', () => {
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
    expect(PAGE).toContain('text-ink')
    expect(PAGE).toContain('bg-canvas')
    expect(PAGE).toContain('border-hairline')
  })
})
