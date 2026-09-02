import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * テンプレート一覧（設計 `W7LBc` 11-1）の、状態と押し口。
 *
 * リッチメッセージ作成（設計 `j9ixI` 11-1-D）に当たるルートは無い。
 * 作らずに、要る口を `docs/design-qa/v6-11-1-d-rich-message-handoff.md`
 * へ書いた。
 */
describe('テンプレート一覧の状態と押し口', () => {
  it('画面が名乗っているNodeを面に付ける', () => {
    // 撮影で「どの設計と比べる面か」が分からないと、比較が始められない。
    expect(PAGE).toContain('data-design-node="W7LBc"')
    expect(PAGE).toContain('data-design-node="W7LBc kcmGB"')
    expect(PAGE).toContain('data-design-node="W7LBc FuBeQ"')
  })

  it('読込中・権限不足・取得失敗・初回空・0件を言い分ける', () => {
    expect(PAGE).toContain("import ListState from '@/components/shared/list-state'")
    expect(PAGE).toContain('const view = listView({')
    expect(PAGE).toContain("view === 'forbidden'")
    expect(PAGE).toContain("view === 'error'")
    expect(PAGE).toContain('まだテンプレートがありません')
    expect(PAGE).toContain('条件に合うテンプレートはありません')
    // 4つを1つにまとめていた文。戻したら落とす。
    expect(PAGE).not.toContain('該当するテンプレートがありません')
  })

  it('取得失敗は読み直せる形で出す', () => {
    expect(PAGE).toContain('再読み込み')
    expect(PAGE).toContain('title={failure?.title}')
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
    expect(PAGE).toContain('id="tpl-create-blocked"')
    expect(PAGE).toContain('{createBlocked}')
  })

  it('繋がっていない送信数を「確認できます」と書かない', () => {
    expect(PAGE).toContain('送信数はまだ繋がっていません')
    expect(PAGE).not.toContain('使われている場所・送信数を確認できます')
  })
})
