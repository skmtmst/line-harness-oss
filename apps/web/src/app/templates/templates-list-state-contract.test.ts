import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, '../../v8/templates/list.tsx'), 'utf8')

/**
 * テンプレート一覧（設計 `W7LBc` 11-1）の、状態と押し口。
 *
 * 板の印・読込中／権限不足／取得失敗／初回空／0件の言い分け・読み直し・作成を押せない理由・
 * 今月送った数と累計は templates-list-behavior.test.tsx で、画面を開いて確かめる。
 * ここに残すのは、まとめていた古い文と書き方へ戻さない見張りだけ。
 */
describe('テンプレート一覧の状態と押し口', () => {
  it('読込中・権限不足・取得失敗・初回空・0件を言い分ける', () => {
    // 4つを1つにまとめていた文。戻したら落とす。
    expect(PAGE).not.toContain('該当するテンプレートがありません')
  })

  it('一覧の読み込み失敗を、操作の失敗と同じ帯に混ぜない', () => {
    // 混ぜると「削除に失敗しました」が読み込み失敗の場所に出る。
    expect(PAGE).not.toContain("setError('テンプレートの読み込みに失敗しました。')")
  })

  it('実送信数は今月分を表示し、未取得を0にしない', () => {
    const count = PAGE.slice(PAGE.indexOf('function sendCountText'), PAGE.indexOf('function publishStateOf'))
    expect(count).not.toContain('t.monthlySendCount ?? 0')
  })
})
