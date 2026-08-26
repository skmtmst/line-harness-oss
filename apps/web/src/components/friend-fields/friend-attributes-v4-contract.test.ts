import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'src')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('友だち属性 V4 contract', () => {
  it('タグ作成で本人・紹介者マイルと倍率を同時に設定できる', () => {
    const editor = read('components/friend-fields/tag-editor-v4.tsx')
    const page = read('components/friend-fields/new-tag-page-v4.tsx')
    expect(editor).toContain('本人へのマイル付与')
    expect(editor).toContain('紹介者へのマイル付与')
    expect(editor).toContain('今後のマイル倍率')
    expect(editor).toContain('タグを外して付け直したときの扱い')
    expect(page).toContain('applyToExisting: false')
  })

  it('タグ編集の遡及付与は初期OFFで専用確認を通す', () => {
    const editor = read('components/friend-fields/tag-editor-v4.tsx')
    const page = read('components/friend-fields/edit-tag-page-v4.tsx')
    expect(editor).toContain("useState(initialValues?.applyToExisting ?? initialApplyToExisting)")
    expect(editor).toContain('すでに付いている人への反映')
    expect(editor).toContain('さかのぼってマイルを積みますか？')
    expect(page).toContain('applyToExisting: applyRetroactive && values.applyToExisting')
  })

  it('一覧は20・30・40・50件で切り替え、ページを無限に横並びにしない', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    expect(source).toMatch(/\[20,\s*30,\s*40,\s*50\]/)
    // 2026-08-26: ページ送りは共通部品 `Pagination`（設計 `Blot6`）へ寄せた。
    // 自前で組むと、高さ38・角丸・現在ページの緑がほかの一覧とずれる。
    expect(source).toContain('<Pagination')
    expect(source).not.toContain("'前へ'")
    expect(source).toContain('CSVで一括登録')
    // 2026-08-26: 「並び替え」ボタンは設計に無い。つまみを常に出して、
    // いつでも並び替えられるようにした（docs/v6-shell-contract.md の 4-1 基準）。
    expect(source).not.toContain('並び替えを終了')
    expect(source).toContain('ドラッグして並び替え')
    expect(source).not.toContain('min-w-[1180px]')
  })

  it('情報欄と対応マークもPC画面で横スクロールを要求しない', () => {
    const sources = [
      read('components/friend-fields/field-list.tsx'),
      read('components/friend-fields/mark-list.tsx'),
    ]
    for (const source of sources) {
      expect(source).toContain('table-fixed')
      expect(source).not.toMatch(/min-w-\[/)
      expect(source).not.toContain('overflow-x-auto')
    }
  })

  it('友だち属性ではブラウザ標準confirmを使わない', () => {
    const sources = [
      read('components/friend-fields/tags-page-v4.tsx'),
      read('components/friend-fields/tag-editor-v4.tsx'),
      read('components/friend-fields/edit-tag-page-v4.tsx'),
      read('components/friend-fields/field-list.tsx'),
      read('components/friend-fields/mark-list.tsx'),
      read('components/friend-fields/saved-search-list.tsx'),
    ]
    for (const source of sources) {
      expect(source).not.toMatch(/\bconfirm\s*\(/)
    }
  })

  it('Pen.devで指定された8状態を検証用ルートから再現できる', () => {
    const source = read('app/visual-qa/friend-attributes/page.tsx')
    for (const state of ['list', 'create', 'linked', 'drawer', 'edit', 'retroactive', 'delete', 'folder']) {
      expect(source).toContain(`'${state}'`)
    }
    expect(source).toContain('LINKED_ACTIONS')
    expect(source).toContain('initialRetroactiveOpen')
    expect(source).toContain('<DeleteDialog')
    expect(source).toContain('<FolderEditor')
  })

  it('空・読込・エラー・権限不足を言い分ける', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // 設計 ★V6 4-2-C `yKEdO`。共通部品に寄せる（自前で組むと画面ごとにずれる）。
    expect(source).toContain("import ListState from '@/components/shared/list-state'")
    for (const kind of ['loading', 'forbidden', 'error', 'empty']) {
      expect(source, `${kind} を出していない`).toContain(`kind="${kind}"`)
    }
    // 403 は「壊れた」ではなく「見せてよい人ではない」。同じ扱いにしない。
    expect(source).toContain("reason.status === 403 ? 'forbidden' : 'error'")
    // 読み込めなかったときに「ありません」と言い切らない（PR #216 と同じ壊れ方）。
    const empty = source.indexOf('まだタグがありません')
    expect(empty).toBeGreaterThan(-1)
    const before = source.slice(0, empty)
    expect(before.lastIndexOf("status === 'error'")).toBeGreaterThan(-1)
    // 中身を出せていないあいだは数を出さない。0件と出すと消えたように見える。
    expect(source).toContain("const ready = status === 'ready'")
    expect(source).toContain('countsKnown={ready}')
    // 権限が無いときは作る操作を出さない。
    expect(source).toContain("status === 'forbidden' ? null : (")
  })

  it('取れていない値を「0件」や「手動」で埋めない', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // 自動付与のもと。サーバーは断定できないものを省く（`getTagsWithUsage`）。
    // ここで「手動」と埋めると、断定できなかったものを断定したことになる。
    expect(source).toContain("tag.assignSource ? SOURCE_LABELS[tag.assignSource] : '—'")
    // 使用先。`withCounts=1` で読んでいるので、無いのは0件＝「未使用」。
    expect(source).toContain("api.tags.list({ withCounts: true })")
    expect(source).toContain("if (!tag.usedIn) return '未使用'")
    // 連動の「他N」。0件のときサーバーは省くので「他0」は出ない。
    expect(source).toContain('if (tag.otherActionCount) chips.push(')
    // 整理候補は「未使用＋重複名」で、未使用の数とは別物。まだ返らない。
    expect(source).toMatch(/title: '整理候補', value: null/)
    // 削除の確認に固定値を書かない。
    expect(source).not.toMatch(/参照<\/dt><dd[^>]*>3件/)
    expect(source).toContain("{ name: '積んだマイル', value: '—'")
  })

  it('「よく使う」は設計の5つで、どれも絞り込みに効く', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    for (const label of ['未使用のタグ', '今月増えたタグ', '自動付与あり', '連動あり', '★のみ表示']) {
      expect(source, `よく使うに「${label}」が無い`).toContain(label)
    }
    // 2026-08-26: 「今月増えた」は札だけあって、絞り込みに枝が無く
    // **押しても何も起きなかった**。5つとも枝があることを見る。
    for (const key of ['unused', 'recent', 'auto', 'linked', 'starred']) {
      expect(source, `よく使う「${key}」に絞り込みの枝が無い`).toContain(`key === '${key}'`)
    }
  })

  it('CSVは押したとおりのことをして、名前が毎回変わる', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // 設計の文言は「CSVで一括登録」だが、取り込みの画面もAPIもまだ無い。
    // 取り込みと書いて出力するのは嘘なので、いまは「出力」と書く。
    expect(source).toContain('CSVで出力')
    // `tags.csv` 固定だと、2回目から `tags (1).csv` になって区別が付かない。
    expect(source).not.toContain("download = 'tags.csv'")
    expect(source).toContain("['タグ一覧', scope, today]")
  })

  it('タグの作成・編集・一覧ルートはV4を既定表示にする', () => {
    expect(read('app/tags/page.tsx')).toContain('<TagsPageV4 />')
    expect(read('app/tags/new/page.tsx')).toContain('<NewTagPageV4 />')
    expect(read('app/tags/edit/page.tsx')).toContain('<EditTagPageV4 />')
  })
})
