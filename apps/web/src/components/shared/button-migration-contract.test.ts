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
  it('7ルートの標準操作32個を共通Buttonで維持する', () => {
    const openings = Object.entries(sources).flatMap(([path, source]) => {
      expect(source, `${path} が共通Buttonを直接importしていない`).toContain(
        "import Button from '@/components/shared/button'",
      )
      return buttonOpenings(path, source)
    })

    // 2026-08-28: 分析V6の保存結果を、名前を付けて保存できるようにした。
    // 未実装のCSV・定期レポート操作は数へ入れない。
    expect(openings).toHaveLength(32)
    expect(openings.filter((opening) => opening.includes('variant="primary"'))).toHaveLength(12)
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
    // 2026-08-27: 受信箱の絞り込みパネルに「この条件で絞り込む」を置いた。
    // 設計 `bXyEA` の主操作。パネルの中の押しきりなので画面側に置く。
    // 同日: 保存した検索のモーダルに「この条件を保存」「閉じる」を置いた。
    // 設計 `Ln4zS` の押しきり。モーダルの中なので画面側に置く。
    // 2026-08-27: タグ作成・編集の保存操作を共通Buttonへ寄せたため1つ減った。
    // 2026-08-27: シナリオのフォルダ追加を共通ダイアログへ寄せ、
    // 画面内に重複していた主要操作1つが減って136。
    // 2026-08-31: #422 がタグ作成・編集の保存を共通Buttonへ寄せたぶん、
    // development の136から1つ減って135。統合後の実測へ合わせる。
    // 2026-09-01: #424 の受信箱操作と最新 development を統合した木を再計測し、
    // 主要操作は138。片側の古い基準値は採用していない。
    // 2026-09-01: #437 が共通情報の作成導線を共通Buttonへ寄せたため、
    // 最新 development の138から1つ減る。統合後の実測へ合わせる。
    expect(debt['direct-primary-button']).toBe(137)
    // ★V6 3-1（PhxG6）の38pxヘッダー操作2つと、保存検索ダイアログの
    // 閉じる操作1つは、既存V5ボタンの36pxと形が違うため画面側に残す。
    //
    // 2026-08-27: ダッシュボードの受信カードが自前の「前へ／次へ」をやめて
    // 共通ページ送りへ寄せた。副次2つ減って280。**減ったので締め直す。**
    // 同日: 受信箱の担当者・対応マークを専用プルダウンにした。開いた中身が
    // ブラウザ任せだと画像に写らず、設計の 2-8/2-9/2-10 を見比べられない
    // ため。**開く操作の2つは共通Buttonにしない。** 設計（`lJ1CF` `k6lHgo`）
    // の見た目は枠と山形の付いた選択操作で、共通Buttonの形とは違う。
    // 増えたぶんをここに記録して止める。
    // 同日: 絞り込みパネルの「リセット」を足した。
    // 同日: テンプレートの置き場も専用プルダウンへ替えた。開く操作は
    // 共通Buttonにしない（設計の見た目が選択操作で、Buttonの形とは違う）。
    // 2026-08-27: 同じ画面のキャンセル・複製・続けて作るも共通Buttonへ寄せた。
    // 2026-08-28: マイル正本をV6へ移し、動かないマニュアル・CSV・再読込の
    // 自前ボタン3つを除いた。回答フォームの再読込も共通Buttonへ寄せたため、
    // 合計で4つ減った。さらに分析の死んだ旧UIを削除し、共通Buttonへ寄せたため、
    // 265まで減った。写真審査の操作3つも共通Button/Dialogへ寄せ、262まで減った。
    // シナリオでも重複送信・フォルダ追加・使えない並び替えの3つを除き、259まで減った。
    // 友だち追加時配信の本文に重複していたマニュアルも除き、258まで減った。
    // 2026-08-31: #422 がタグ編集のキャンセル・複製・続けて作るを共通Buttonへ
    // 寄せたぶん、development 側でも259から3つ減って256。
    // 2026-09-01: この枝と development の両方が同じ259から減らしていた。
    // 片方を選ぶとどちらかの成果が数から消えるので、**統合後の木で数え直した**。
    // 2026-09-01: #525 がNEN配信から押せない重複ヘッダー操作を1つ外した。
    // development の255から1つ減ることを統合後の木で再計測した。
    // 2026-09-01: #507 がウェビナー公開ページの操作を共通Buttonへ寄せた。
    // development の254から1つ減ることを統合後の木で再計測した。
    // 2026-09-01: #424 の専用プルダウン等と最新 development を統合した木を
    // 再計測し、副次操作は258。古い285へは戻していない。
    // 2026-09-01: #435 がリッチメニューの動かないマニュアルを削除したため、
    // 最新 development と統合した木で1つ減ることを再計測した。
    // 2026-09-01: #438 が登録メディアの再読込を共通Buttonへ寄せたため、
    // 最新 development と統合した木で1つ減ることを再計測した。
    // 2026-09-01: #437 が共通情報から準備中のマニュアルと並び替えを外したため、
    // 最新 development の256から2つ減る。統合後の実測へ合わせる。
    expect(debt['direct-secondary-button']).toBe(254)
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
    // 「友だちの状態」を設計の3行＋内訳に組み直した。
    // 同日: 受信箱の担当者絞り込みが、色を直に書いた素のセレクトから
    // 専用プルダウンへ替わった。**減ったので締め直す。**
    // 同日: 絞り込みを `<details>` の小箱からパネルへ替え、色を直に書いた
    // 部分が消えた。**減ったので締め直す。**
    // 同日: テンプレートの置き場が色を直に書いた素のセレクトから部品へ
    // 替わった。**減ったので締め直す。**
    // 同日: 保存した検索のモーダルを足した。設計 `Ln4zS` の
    // 実測値（560px幅・44px高・11pxの字数表示）。増えたぶんを記録して止める。
    // 保存検索の保存ダイアログと
    // マイル概要もV6トークンへ寄せ、分析画面の旧UIも削除した。
    // タグ編集の本文用32px見出しも削除し、トップバーだけを画面名の正本にした。
    // 2026-08-31: #422 がタグ編集の本文用32px見出しを削除したぶん、
    // development の1243から1つ減って1242。統合後の実測へ合わせる。
    // 2026-09-01: #424 と最新 development の統合後の木を再計測し1232。
    // #424 の古い1274、development 単独の1242のどちらも採用していない。
    // 同日: メディアの削除確認で `text-[11px]` を `text-micro` に寄せ、
    // 1232→1231。**減ったので締め直す。**
    expect(debt['arbitrary-value']).toBe(1231)
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
