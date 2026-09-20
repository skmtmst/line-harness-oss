import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * 監査 #1011 の友だち詳細まわり（FRIEND-21〜27・31）の画面契約。
 * 見た目の正本はPencil側。ここでは「直した振る舞いが戻らない」ことだけを見る。
 */
describe('友だち詳細 監査#1011の契約', () => {
  it('FRIEND-21: 情報欄の分類をリンクで切り替えられる', () => {
    expect(PAGE).toContain('groupChips')
    expect(PAGE).toContain('aria-label="情報欄の分類"')
    expect(PAGE).toContain("aria-current={active ? 'true' : undefined}")
    // 「すべて」と「基本」を分け、消えた分類は「分類が見つからない」と正直に出す。
    expect(PAGE).toContain("const ALL_GROUP = 'all'")
    expect(PAGE).toContain('この分類は削除されたか、見つかりません')
    expect(PAGE).toContain('基本の項目を見る')
  })

  it('FRIEND-22: 項目名ラベルと入力欄が htmlFor/id で結び付く', () => {
    expect(PAGE).toContain('htmlFor={inputId}')
    expect(PAGE).toContain('id={inputId}')
    expect(PAGE).toContain('labelId={`${inputId}-label`}')
    // 複数選択の表示型は aria-labelledby で項目名へ戻る。
    expect(PAGE).toContain('aria-labelledby={labelId}')
  })

  it('FRIEND-23: 権限で隠れた項目と「項目なし」を分ける', () => {
    expect(PAGE).toContain('hiddenPersonalCount > 0')
    expect(PAGE).toContain('個人情報の閲覧権限が要ります')
    // 権限で隠れているだけのときは「項目を追加」を勧めない。
    expect(PAGE).toContain('canManageFieldDefs && hiddenPersonalCount === 0')
  })

  it('FRIEND-24: 回答フォームは質問のlabelを見出しにする', () => {
    expect(PAGE).toContain('labelByName')
    expect(PAGE).toContain('labelByName.get(k)')
    // 定義に無いキー（削除済みの質問）は原キーを残す。
    expect(PAGE).toContain('現在は使われていない項目')
  })

  it('FRIEND-25: 保存待ちの間に書き換えた欄は再取得で上書きしない', () => {
    expect(PAGE).toContain('saveSnapshotRef')
    expect(PAGE).toContain('saveSnapshotRef.current = { ...values }')
    expect(PAGE).toContain('prev[f.id] !== sentSnapshot[f.id]')
  })

  it('FRIEND-26: 「さらに読み込む」の失敗は末尾だけに出す', () => {
    expect(PAGE).toContain('historyMoreError')
    expect(PAGE).toContain('続きを読み込めませんでした')
    expect(PAGE).toContain("'もう一度試す'")
    // 追加読み込み失敗で履歴全体をエラー画面にしない。
    expect(PAGE).toContain('if (cursor) setHistoryMoreError(true)')
  })

  it('FRIEND-27: 準備中タブには利用者向けの説明と代替操作がある', () => {
    expect(PAGE).toContain('pendingTabActions')
    // 開発者向けの「口がまだありません」で行き止まりにしない。
    expect(PAGE).not.toContain('を引く口がまだありません')
    expect(PAGE).toContain('この友だちをシナリオに登録')
  })

  it('FRIEND-31: 狭い画面では補助プロフィールを畳む', () => {
    expect(PAGE).toContain('profileExpanded')
    expect(PAGE).toContain('顧客情報をすべて表示')
    expect(PAGE).toContain('max-lg:hidden')
    // PC由来の固定高をスマートフォンへ持ち込まない。
    expect(PAGE).not.toContain('style={{ minHeight: 1234 }}')
    expect(PAGE).toContain('lg:min-h-[1234px]')
  })
})
