import { readUiSource, readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(new URL('./page.tsx', import.meta.url), 'utf8')
const NEW_PAGE = readFileSync(new URL('./new/page.tsx', import.meta.url), 'utf8')

/**
 * 管理画面 19-1 成果地点（`/conversions?tab=points`）の契約。
 *
 * `nodeByTab` に `points` と `report` が無く、**`data-design-node={undefined}`
 * がそのまま出ていた。** 設計と実装を突き合わせる手掛かりが消えるので、
 * 5タブぶんすべてを埋める。
 *
 * 併せて、押せない検索・並び順・期間・書き出し・前後ボタンを、
 * 動く共通部品か「繋がっていない」の言葉のどちらかにする。
 */
describe("管理画面 成果地点一覧の契約", () => {

  it('空・読込・取得失敗の3状態を共通ListStateで言い分ける', () => {
    expect(PAGE).toContain("import ListState from '@/components/shared/list-state'")
    expect(PAGE).toContain('<ListState kind="loading"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('<EmptyList')
    expect(PAGE).toContain('成果地点を読み込めませんでした')
    expect(PAGE).toContain('onRetry=')
    expect(PAGE).toContain('onRetry={() => void load()}')
    expect(PAGE).toContain('const [loadFailed, setLoadFailed] = useState(false)')
  })

  it("管理画面一覧APIの集計・状態・利用先をそのまま使う", () => {
    expect(PAGE).toContain('api.conversions.definitions({')
    expect(PAGE).toContain('formatNumber(point.metrics.netCount')
    expect(PAGE).toContain('formatNumber(point.metrics.netValue')
    expect(PAGE).toContain('point.usageCount === 0')
    expect(PAGE).toContain('stateCounts.active')
    expect(PAGE).not.toContain('利用先の取得は未接続')
  })

  it('一覧でない返事を成功扱いせず、前の一覧を残さない', () => {
    expect(PAGE).toContain('setDefinitions(null)')
    expect(PAGE).toContain('Array.isArray(response.data.items)')
    expect(PAGE).toContain('listResult.value !== null')
    expect(PAGE).toContain('setLoadFailed(true)')
  })

  it('ページ送りを共通Paginationにする', () => {
    expect(PAGE).toContain("import Pagination from '@/components/shared/pagination'")
    expect(PAGE).toContain('<Pagination page={currentPage} pageCount={pageCount}')
    expect(PAGE).toContain('shown.slice((currentPage - 1) * pageSize, currentPage * pageSize)')
    expect(PAGE).not.toContain('ページの切り替えは準備中です')
  })

  it("期間・管理画面レポート・CSVを実際の口へつなぐ", () => {
    expect(PAGE).toContain('api.conversions.definitionReport({')
    expect(PAGE).toContain('api.conversions.exportDefinitions({')
    expect(PAGE).toContain('CSV で書き出す')
    expect(PAGE).not.toContain('書き出しはまだ繋がっていません。')
    expect(PAGE).not.toContain('CSVの書き出し口は未接続です。')
    expect(PAGE).not.toContain('準備中')
  })


  it('作成画面で重複を止め、入力中の条件だけを試算する', () => {
    expect(NEW_PAGE).toContain('boardId="j8p3yj"')
    expect(NEW_PAGE).toContain('const duplicateName = useMemo')
    expect(NEW_PAGE).toContain('分析の数字が二重になります')
    expect(NEW_PAGE).toContain('api.conversions.previewDefinition({')
    expect(NEW_PAGE).toContain('入力中の条件だけで試算しています。')
    expect(NEW_PAGE).toContain('試算では成果を追加しません。')
    expect(NEW_PAGE).not.toContain('保存前試算APIの接続後')
    expect(NEW_PAGE).not.toContain('準備中')
    expect(NEW_PAGE).not.toContain('Webhookで受け取った')
  })

  it('6起点・30日1回・取消・利用先を定義APIへ保存する', () => {
    expect(NEW_PAGE).toContain("eventType: 'webinar_completed'")
    expect(NEW_PAGE).toContain("eventType: 'tag_added'")
    expect(NEW_PAGE).toContain("setDeduplicationMode('window')")
    // 金額の出し方の選択肢は対応表(origin-labels)の valueModes から作る。
    // 注文の金額が無い起点では 'source' を出さないため、3択の直書きはしない。
    expect(NEW_PAGE).toContain('origin.valueModes')
    expect(NEW_PAGE).toContain("source: '注文の金額'")
    expect(NEW_PAGE).toContain("value: 'source_cancelled', label: '件数と金額を引く'")
    expect(NEW_PAGE).toContain('api.conversions.createDefinition({')
    // N-258: 送る利用先は実在するオブジェクトの実IDだけ。仮IDの固定一覧はない。
    expect(NEW_PAGE).toContain('usages: usageTargets')
    expect(NEW_PAGE).not.toContain('保存契約は未接続')
    expect(NEW_PAGE).not.toContain('利用先APIの接続後')
  })

  it('成果地点が100件を超えても数え落とさない (#505 重大2)', () => {
    // 一覧の `limit: 100` で止めると KPI が小さく出る。cursor を辿って
    // 全件取り、安全弁のときだけ注記を出す。
    expect(PAGE).toContain('pagination.nextCursor')
    expect(PAGE).toContain('直近5000件まで')
  })
})
