import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { countDebt, totals } from '../../../scripts/design-debt.mjs'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB = join(SRC, '..')
const targets = [
  'app/tags/page.tsx',
  'app/reminders/page.tsx',
  'app/templates/page.tsx',
  'app/affiliates/tabs.tsx',
  'app/conversions/page.tsx',
  'app/inflow-links/page.tsx',
  'app/analytics/page.tsx',
]
const sources = Object.fromEntries(
  targets.map((path) => [path, readFileSync(join(SRC, path), 'utf8')]),
)

function buttonOpenings(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const openings: string[] = []
  const walk = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(file) === 'Button'
    ) {
      openings.push(node.getText(file))
    }
    ts.forEachChild(node, walk)
  }
  walk(file)
  return openings
}

describe('標準ボタンの第1段階移行', () => {
  it('7ルートの標準操作36個を共通Buttonで維持する', () => {
    const openings = Object.entries(sources).flatMap(([path, source]) => {
      expect(source, `${path} が共通Buttonを直接importしていない`).toContain(
        "import Button from '@/components/shared/button'",
      )
      return buttonOpenings(path, source)
    })

    // 2026-08-28: テンプレート一覧の再読み込みとフォルダ追加も共通部品へ移した。
    // 2026-08-28: 分析V6の保存結果を、名前を付けて保存できるようにした。
    // 未実装のCSV・定期レポート操作は数へ入れない。
    expect(openings).toHaveLength(36)
    expect(openings.filter((opening) => opening.includes('variant="primary"'))).toHaveLength(14)
  })

  it('共通部品が持つ見た目を画面側で重ねない', () => {
    const handledByPart =
      /(?:bg-accent|border-hairline|text-on-accent|rounded-|px-|py-|text-(?:xs|sm)|font-(?:medium|semibold|bold)|hover:bg-|min-h-)/

    for (const [path, source] of Object.entries(sources)) {
      for (const opening of buttonOpenings(path, source)) {
        expect(opening, `${path} が共通Buttonへ旧指定を重ねている`).not.toMatch(handledByPart)
      }
    }
  })

  it('リンク先と主要な操作ハンドラを維持する', () => {
    const all = Object.values(sources).join('\n')
    for (const href of [
      '/tags/new',
      '/tags/fields/new',
      '/reminders/new',
      '/affiliate-offers/new',
      '/conversions?tab=affiliates',
      '/conversions/new',
      '/inflow-links/new',
    ]) {
      expect(all).toContain(`href="${href}"`)
    }
    for (const handler of [
      'onClick={exportCsv}',
      'onClick={handleCreate}',
      "onClick={() => setEditingGenre('new')}",
      'onClick={save}',
      'onClick={onCancel}',
    ]) {
      expect(all).toContain(handler)
    }
  })

  it('標準ボタン移行後の基準を、D-3の旧画面転送後も締める', () => {
    const debt = totals(countDebt().counts) as Record<string, number>
    // 2026-08-26: 4-1（友だち属性）のヘッダー操作を共通Buttonへ替え、
    // ページ送りも共通部品へ寄せた。主要2・副次7が減った。
    // 減ったら必ずここも締める。
    // 2026-08-27: テンプレート詳細の編集操作を共通Buttonへ移した。
    // 2026-08-27: シナリオのフォルダ追加を共通ダイアログへ寄せ、
    // 画面内に重複していた主要操作1つが減った。テンプレートの作成・再読込も
    // 共通Buttonへ寄せたため135。
    expect(debt['direct-primary-button']).toBe(135)
    // ★V6 3-1（PhxG6）の38pxヘッダー操作2つと、保存検索ダイアログの
    // 閉じる操作1つは、既存V5ボタンの36pxと形が違うため画面側に残す。
    //
    // 2026-08-27: ダッシュボードの受信カードが自前の「前へ／次へ」をやめて
    // 共通ページ送りへ寄せた。副次2つ減って280。**減ったので締め直す。**
    // 2026-08-28: マイル正本をV6へ移し、動かないマニュアル・CSV・再読込の
    // 自前ボタン3つを除いた。回答フォームの再読込も共通Buttonへ寄せたため、
    // 合計で4つ減った。さらに分析の死んだ旧UIを削除し、共通Buttonへ寄せたため、
    // 265まで減った。写真審査の操作3つも共通Button/Dialogへ寄せ、262まで減った。
    // シナリオでも重複送信・フォルダ追加・使えない並び替えの3つを除き、259まで減った。
    // テンプレート詳細の編集操作も共通Buttonへ寄せ、258まで減った。
    expect(debt['direct-secondary-button']).toBe(258)
    /*
      4-1 を設計の実測値へ合わせるたびに増える。設計 `hqrOv` に
      書いてある数で、トークンには無い（26px の札・7px の余白・
      1040px の最小幅・絞り込みの 144/129/116px・間隔 14/10px）。
      **増やしたぶんはここに記録して止める。** 減ったら締め直す。
    */
    // 友だち一覧はV6トークンへ移し、任意値を127か所削除した。
    // 2026-08-29: 統合ユーザー一覧をV6トークンと7列の業務表へ移し、
    // 旧画面の任意値を36か所減らした。
    // 2026-08-27: 「今月の配信」から重複していた送信枠の帯を外し、
    // 「友だちの状態」を設計の3行＋内訳に組み直した。保存検索の保存ダイアログと
    // マイル概要もV6トークンへ寄せ、分析画面の旧UIも削除した。
    // 両方を合わせて1243へ締め直す。
    expect(debt['arbitrary-value']).toBe(1243)
  })

  it('V5基準・V6画面優先と画像比較の未検証を契約へ残す', () => {
    const contract = JSON.parse(readFileSync(join(WEB, 'design', 'design-parts.json'), 'utf8'))
    const part = contract.parts.button

    expect(part.status).toBe('active')
    expect(part.routes.v5).toEqual({ '/tags': 'PbCvb' })
    expect(part.routes.v6).toEqual({
      '/reminders': 'kAnOQ',
      '/templates': 'W7LBc',
      '/affiliates': 'BaLte',
      '/conversions': 'Bw4fy',
      '/inflow-links': 'EQS0v',
      '/analytics': 'XkajG',
    })
    expect(part.migration).toEqual({
      controlsMigratedInThisPr: 33,
      directPrimaryBefore: 168,
      directPrimaryMigrated: 10,
      directPrimaryRemaining: 158,
      directSecondaryBefore: 335,
      directSecondaryMigrated: 20,
      directSecondaryRemaining: 315,
    })
    expect(part.visualVerification.status).toBe('unverified')
  })
})
