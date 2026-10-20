import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, '../../v8/templates/list.tsx'), 'utf8')

/**
 * テンプレート一覧（設計 `W7LBc` 11-1）の、状態と押し口。
 *
 * リッチメッセージ作成（設計 `j9ixI` 11-1-D）に当たるルートは無い。
 * 作らずに、要る口を引き継ぎに書いた（2026-10-07 にリポジトリから外した）。
 */
describe('テンプレート一覧の状態と押し口', () => {
  it('画面が名乗っているNodeを面に付ける', () => {
    // 撮影で「どの設計と比べる面か」が分からないと、比較が始められない。
    expect(PAGE).toContain("boardId={narrow ? 'L7zA7C' : 'v19Ivv'}")
    expect(PAGE).toContain('data-design-node="susGP"')
    expect(PAGE).toContain('<EmptyList')
  })

  it('読込中・権限不足・取得失敗・初回空・0件を言い分ける', () => {
    expect(PAGE).toContain("import ListState from '@/components/shared/list-state'")
    expect(PAGE).toContain('const view = listView({')
    expect(PAGE).toContain("view === 'forbidden'")
    expect(PAGE).toContain("view === 'error'")
    expect(PAGE).toContain('title={`まだ${sectionWord}がありません`}')
    expect(PAGE).toContain('filtered={filterActive}')
    // 4つを1つにまとめていた文。戻したら落とす。
    expect(PAGE).not.toContain('該当するテンプレートがありません')
  })

  it('取得失敗は読み直せる形で出す', () => {
    // ★管理画面 `x63W5x`：古い個別ボタン（`action`）ではなく、共通の再読み込み口（`onRetry`）。
    // ボタンの文言は共通部品（ListState）が持つ。ここでは口があることだけ見る。
    expect(PAGE).toContain('onClick={() => load()}')
    expect(PAGE).toContain("failure?.title ?? '見る権限がありません'")
  })

  it('一覧の読み込み失敗を、操作の失敗と同じ帯に混ぜない', () => {
    // 混ぜると「削除に失敗しました」が読み込み失敗の場所に出る。
    expect(PAGE).toContain('const [failure, setFailure]')
    expect(PAGE).toContain('setFailure(failureOf(e))')
    expect(PAGE).toContain('setFailure(failureOfResponse())')
    expect(PAGE).not.toContain("setError('テンプレートの読み込みに失敗しました。')")
  })

  it('読み込めていないあいだ、作成を押せる形で置かない', () => {
    expect(PAGE).toContain('disabled={createBlocked !== null}')
    expect(PAGE).toContain('title={createBlocked ?? undefined}')
    expect(PAGE).toContain('createBlockedReason({ loading, failure })')
  })

  it('実送信数は今月分を表示し、未取得を0にしない', () => {
    expect(PAGE).toContain('今月送った数')
    expect(PAGE).toContain('`累計 ${formatNumber(t.totalSendCount)} 通`')
    expect(PAGE).toContain("typeof t.monthlySendCount !== 'number'")
    const count = PAGE.slice(PAGE.indexOf('function sendCountText'), PAGE.indexOf('function publishStateOf'))
    expect(count).not.toContain('t.monthlySendCount ?? 0')
  })
})
