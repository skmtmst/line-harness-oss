import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 監査 R181〜R190（友だち情報欄の既定値・保存した検索・タグ）の修正を固定する契約試験。
 * 画面の見た目ではなく「以前の壊れ方が戻っていないか」を見る。
 */

const root = resolve(process.cwd(), 'src')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const FIELD_NEW = read('app/tags/fields/new/page.tsx')
const FIELD_EDIT = read('app/tags/fields/edit/page.tsx')
const DEFAULT_INPUT = read('components/friend-fields/default-value-input.tsx')
const SEARCH_EDIT = read('app/tags/searches/edit/page.tsx')
const FRIENDS_PAGE = read('app/friends/page.tsx')
const ADV_DIALOG = read('components/friends/advanced-search-dialog.tsx')
const TAGS_PAGE = read('components/friend-fields/tags-page-v4.tsx')

describe('R182 単一選択の既定値はIDのまま比べない', () => {
  it('編集画面は保存済み既定値を選択肢名へ戻して未保存を判定する', () => {
    expect(FIELD_EDIT).toContain('storedDefaultLabels')
    expect(FIELD_EDIT).toContain('!sameLabels(defaultOptions, storedDefaults.multi)')
    // IDのまま比べる旧式は残さない。
    expect(FIELD_EDIT).not.toContain("defaultValue !== (field.defaultValue ?? '')")
  })
})

describe('R183 逆転期間は保存前に断り欄でも知らせる', () => {
  it('編集画面は逆転を保存前の検査で止める', () => {
    expect(SEARCH_EDIT).toContain('期間の開始日が終了日より後になっています')
  })

  it('編集画面の日付欄の下で入れ替えを促す', () => {
    expect(SEARCH_EDIT).toContain('開始日が終了日より後になっています。入れ替えてください。')
  })

  it('友だち画面の登録日ブロックでも逆転を知らせる', () => {
    expect(ADV_DIALOG).toContain('開始日が終了日より後になっています。入れ替えると保存できます。')
  })
})

describe('R184 別の検索へ移ったら未計算の印を捨てる', () => {
  it('詳細の読み込みで未計算フラグと前の失敗を初期化する', () => {
    const loaded = SEARCH_EDIT.slice(SEARCH_EDIT.indexOf('R184'))
    expect(loaded).toContain('setPreviewStale(false)')
    expect(loaded).toContain('gateRef.current.invalidate()')
  })
})

describe('R185 友だち画面で作れる条件は編集画面でも編集できる', () => {
  it('実行できる種類がすべて選べる', () => {
    for (const kind of [
      'event_booking', 'calendar_booking', 'form', 'purchase', 'last_activity',
      'reminder', 'memo', 'common_event', 'assignee',
    ]) {
      expect(SEARCH_EDIT).toContain(`{ value: '${kind}'`)
    }
    // 「未接続」として削除を迫る分岐は残さない。
    expect(SEARCH_EDIT).not.toContain('未接続の条件を削除してください')
    expect(SEARCH_EDIT).not.toContain('UNSUPPORTED_KINDS')
  })

  it('存在確認は値なしで保存でき、日付は「以降」の形も読む', () => {
    expect(SEARCH_EDIT).toContain('EXISTENCE_KINDS')
    expect(SEARCH_EDIT).toContain('dateRangeOf')
    expect(SEARCH_EDIT).toContain('選択済みの回答フォーム')
  })
})

describe('R186 複数行テキストの既定値は複数行欄', () => {
  it('新規・編集とも textarea 種は複数行モードで出す', () => {
    expect(FIELD_NEW).toContain("type === 'textarea' ? 'longtext'")
    expect(FIELD_EDIT).toContain("field.type === 'textarea' ? 'longtext'")
    expect(DEFAULT_INPUT).toContain("mode === 'longtext'")
    expect(DEFAULT_INPUT).toContain('<TextArea')
  })
})

describe('R187 直URLでも保存した並び順・表示件数を使う', () => {
  it('保存した検索の詳細を取って一覧の選択へそろえる', () => {
    expect(FRIENDS_PAGE).toContain('api.savedSearches.detail(savedId, accountId)')
    expect(FRIENDS_PAGE).toContain('setSortMode(params.sort)')
    expect(FRIENDS_PAGE).toContain('setPageSize(Number(params.limit)')
  })
})

describe('R188 並び順の名前と実装を一致させる', () => {
  it('編集画面は友だち追加順と書く', () => {
    expect(SEARCH_EDIT).toContain('友だち追加の新しい順')
    expect(SEARCH_EDIT).toContain('友だち追加の古い順')
    expect(SEARCH_EDIT).not.toContain('最終接触が新しい順')
    expect(SEARCH_EDIT).not.toContain('最終接触が古い順')
  })
})

describe('R190 タグの操作名は保管に統一する', () => {
  it('一覧の確認窓は保管と書き、保管済みに同じ確認を出さない', () => {
    expect(TAGS_PAGE).toContain('を保管しますか？')
    expect(TAGS_PAGE).toContain('このタグを保管する')
    expect(TAGS_PAGE).toContain("tag.status === 'archived' ? undefined")
    expect(TAGS_PAGE).not.toContain('このタグを削除する')
  })
})
