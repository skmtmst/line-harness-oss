import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'pets-tab.tsx'), 'utf8')

/**
 * #984 LAY-17: ペット一覧の操作列。
 *
 * 幅64px（w-16）の操作列に「編集」「詳細」が入らず、1文字ずつ縦に
 * 折れていた。幅を先に確保し、折り返さず、縮まないこと。
 * スマホでは細い表の列に頼らず、カードの下に操作行を置く。
 */
describe('ペット一覧の操作列（#984 LAY-17）', () => {
  it('表の操作列は先に幅を確保する', () => {
    // 「飼い主」「編集」の枠付きボタン＋「⋯」の場所取り（約174px）が入る幅。
    // R618で判明：w-40（160px）では中身がセルからはみ出し、全幅で横スクロール
    // が出ていた。w-16（64px）へは戻さない。
    expect(PAGE).toContain('w-52')
    expect(PAGE).not.toContain('<Th className="w-16"')
    expect(PAGE).not.toContain('<Th className="w-40"')
  })

  it('操作は折り返さず縮まない', () => {
    // 折り返し禁止は共用 ActionCell と RowActions（white-space: nowrap）で担保する。
    expect(PAGE).toContain('<ActionCell')
    expect(PAGE).toContain('<RowActions')
  })

  it('行の操作は共用 RowActions で「詳細→編集」の順にする（#985 LAY-18）', () => {
    // 「詳細」の行き先は飼い主の友だち詳細なので「飼い主」と明記する。
    expect(PAGE).toContain("import { RowActions } from '@/components/shared/row-actions'")
    expect(PAGE).toContain("detail={{ label: '飼い主'")
    expect(PAGE).toContain('edit={canEdit ? { onClick: onEdit } : undefined}')
    // 画面ごとの裸の文字リンク・ボタン装飾へは戻さない。
    expect(PAGE).not.toContain('text-accent-deep">編集</button>')
  })

  it('スマホではカードの下に操作行を置く', () => {
    expect(PAGE).toContain('md:hidden')
    expect(PAGE).toContain('hidden md:block')
    expect(PAGE).toContain('data-design="CardActions"')
    expect(PAGE).toContain('function PetCard(')
  })
})

describe('ペット一覧の1152px・1440px・1920px収まり（R618）', () => {
  it('はみ出しの真因（操作列の中身）を幅に収める', () => {
    // 旧説「固定幅の合計が容器1103pxに収まる」は誤りで、真因は操作列の中身が
    // w-40からはみ出して外枠の scrollWidth を押し広げていたこと（全幅で+26px）。
    // 直し：操作列 w-52・体重の更新 w-24（見出し5文字が w-20 に収まらない）。
    expect(PAGE).toContain('<Th className="w-52"')
    expect(PAGE).toContain('<Th className="w-24">体重の更新</Th>')
    expect(PAGE).not.toContain('<Th className="w-64"')
    expect(PAGE).not.toContain('<Th className="w-16"')
  })

  it('狭い容器では運動量を畳み、主食の幅を譲る', () => {
    // members-tab と同じ @container＋cq-hide の前例。1152px・1440pxの容器
    // （約1080px）では運動量を畳み、1920pxでは10列すべて出す。
    // 運動量の効果は「今日の目安」に残り、スマホのカードにもともと無い列。
    expect(PAGE).toContain('<DataTable className="@container">')
    expect(PAGE).toContain('<Th className="cq-hide-below-1120 w-20">運動量</Th>')
    expect(PAGE).toContain('<Td className="cq-hide-below-1120 w-20">')
  })

  it('短い値は1行省略＋全文を出す', () => {
    expect(PAGE).toContain('title={NEUTERED_LABEL[pet.neutered]}')
    expect(PAGE).toContain('title={pet.activityLabel}')
    expect(PAGE).toContain("title={pet.productName ?? '（未設定）'}")
  })
})
