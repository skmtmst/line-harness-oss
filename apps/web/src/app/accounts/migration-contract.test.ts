import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseUidCsv, splitUidCsvLine } from './migration'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'migration.tsx'), 'utf8')
/* #984 LAY-14: 友だち配下の主タブの正本。 */
const TABS = readFileSync(join(HERE, '..', 'friends', 'friends-tabs.ts'), 'utf8')

/**
 * UID移行の対応表（設計 ★V6 機能3 `vtBCu`）。点検 #496 の項目2・6・9。
 *
 * **21件目以降も判断できる**こと（ページ送り＋未判断のみ）、
 * **引用符・列ずれの行を結び付けない**こと、**一致先なしに
 * 新規作成を選ばせない**ことを守る。
 */
describe('V6 機能3 UID移行の対応表', () => {
  it('引用符の中のカンマで列をずらさない', () => {
    expect(splitUidCsvLine('U1,"山田,太郎",x')).toEqual(['U1', '山田,太郎', 'x'])
  })

  it('二重引用符を1つに戻す', () => {
    expect(splitUidCsvLine('U1,"山田 ""T"" 太郎",x')).toEqual(['U1', '山田 "T" 太郎', 'x'])
  })

  it('閉じていない引用符の行は捨てる', () => {
    expect(splitUidCsvLine('U1,"山田,太郎')).toBeNull()
  })

  it('引用符付きの対応表を取り込める', () => {
    expect(parseUidCsv('old_uid,new_uid\n"old,1","new,1"\nold-2,new-2')).toEqual([
      { oldUid: 'old,1', newUid: 'new,1', evidenceType: 'operator_csv' },
      { oldUid: 'old-2', newUid: 'new-2', evidenceType: 'operator_csv' },
    ])
  })

  it('列の数が合わない行は結び付けず読み飛ばす', () => {
    expect(parseUidCsv('old_uid,new_uid\nold-1,new-1,余分\nold-2')).toEqual([])
  })

  it('必須列がなければ空にする', () => {
    expect(parseUidCsv('foo,bar\nold-1,new-1')).toEqual([])
  })

  it('対応表をページで区切って読む', () => {
    expect(PAGE).toContain('limit')
    expect(PAGE).toContain('offset')
    expect(PAGE).toContain('ITEM_PAGE_SIZE')
    expect(PAGE).not.toContain('.slice(0, 20)')
  })

  it('分類と未判断のみの絞り込みを持つ', () => {
    expect(PAGE).toContain('分類で絞り込む')
    expect(PAGE).toContain('未判断のみ')
    expect(PAGE).toContain('pendingOnly')
  })

  it('一致先なしの行に新規作成を選ばせない', () => {
    expect(PAGE).toContain('一致先なし')
    expect(PAGE).toContain("onDecide(item, 'link')")
    expect(PAGE).not.toContain("item.newUid ? 'link' : 'create'")
  })
})

/**
 * #984 LAY-13/14: UID移行のタブとフォームの段組み。
 * 主タブは友だち一覧と同じ定義・同じ部品・同じ選択色。
 * 入力は「移行元 → 移行先」の同幅2欄、全幅の利用目的、CSV、操作の順。
 */
describe('UID移行のタブと段組み（#984 LAY-13/14）', () => {
  it('主タブは友だち一覧と同じ定義・同じ部品を使う', () => {
    expect(PAGE).toContain("import { FRIENDS_MERGED_TABS } from '@/app/friends/friends-tabs'")
    expect(PAGE).toContain('<MergedTabs')
    expect(PAGE).toContain('active="uid-migration"')
    // 手書きの別タブ実装（青い選択色の nav）へは戻さない。
    expect(PAGE).not.toContain('aria-label="友だち画面"')
    expect(PAGE).not.toContain('border-b-2 pb-3 font-semibold')
  })

  it('友だち主タブの正本は4項目を同じ順で定義する', () => {
    expect(TABS).toContain("key: 'list'")
    expect(TABS).toContain("key: 'duplicates'")
    expect(TABS).toContain("key: 'merged'")
    expect(TABS).toContain("key: 'uid-migration'")
    expect(TABS).toContain("'/accounts?tab=migration'")
  })

  it('移行履歴は主タブと競合しない補助リンク', () => {
    expect(PAGE).toContain('href="#migration-history"')
  })

  it('プルダウンの全幅は画面側の属性スコープで広げる', () => {
    /*
     * shared/ は Claude 所有領域。U063 と同じく、共有部品を改変せず
     * data-selects-wide の属性スコープで select だけを全幅にする。
     * className="w-full" の上書きはモジュールCSSの .default に負けるため使わない。
     */
    expect(PAGE).toContain('data-selects-wide')
    expect(PAGE).toContain('[data-selects-wide] select { width: 100%; }')
    expect(PAGE).toContain('<SelectField aria-label="移行元アカウント"')
    expect(PAGE).toContain('<SelectField aria-label="移行先アカウント"')
    expect(PAGE).not.toContain('size="full"')
    expect(PAGE.match(/<SelectField[^>]*w-full/g) ?? []).toHaveLength(0)
  })

  it('移行元と移行先は同幅の2欄、利用目的は全幅', () => {
    expect(PAGE).toContain('sm:flex-row')
    expect(PAGE.match(/min-w-0 flex-1/g) ?? []).toHaveLength(2)
    expect(PAGE).toContain('利用目的')
    // 利用目的は共通の入力欄（高さ40px・タッチ44pxを部品側が持つ）。
    expect(PAGE).toContain("import { TextField } from '@/components/shared/text-field'")
    expect(PAGE).toContain('<TextField')
  })
})
