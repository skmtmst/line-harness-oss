import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { countDebt, totals } from '../../../scripts/design-debt.mjs'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB = join(SRC, '..')
// 2026-09-02: /tags を外した。`app/tags/page.tsx` に残っていた旧V5の枝は
// 描かれない死んだコードで、そこにあった共通Th 8セルも画面には出ていない。
// 正本の `components/friend-fields/tags-page-v4.tsx` はまだ直書きの `<th>` で、
// 共通Thへは寄せていないため、ここでは見張れない。
const targets = [
  'app/reminders/page.tsx',
  'app/templates/page.tsx',
  'app/conversions/page.tsx',
  'app/inflow-links/page.tsx',
  'app/affiliates/tabs.tsx',
]
const sources = Object.fromEntries(
  targets.map((path) => [path, readFileSync(join(SRC, path), 'utf8')]),
)

describe('表見出しの第1段階移行', () => {
  it('5ルートのV6標準見出し66セルを共通Thで維持する', () => {
    const migrated = Object.values(sources).reduce(
      (sum, source) => sum + (source.match(/<Th\b/g)?.length ?? 0),
      0,
    )
    // 2026-09-02: 描かれない /tags のV5枝を消し、8セル減って65。
    // **減ったので締め直す。**
    // 2026-09-04: テンプレートに「置き場」列を足して66（台帳 #124。
    // フォルダへ入れる口ができたので、行から直接移せるようにした）。
    expect(migrated).toBe(66)

    for (const [path, source] of Object.entries(sources)) {
      expect(source, `${path} が共通表部品をimportしていない`).toContain(
        "import { TableHeadRow, Th } from '@/components/shared/table'",
      )
      expect(source, `${path} が見出し行を共通化していない`).toContain('<TableHeadRow>')
    }
  })

  it('移行したセルに旧色・旧余白・大文字化を重ねない', () => {
    const handledByPart =
      /(?:px-[234]|py-3|text-(?:left|right|center|xs|\[11px\]|ink-faint|gray-500)|font-(?:medium|semibold)|uppercase|tracking-wider|whitespace-nowrap)/

    for (const [path, source] of Object.entries(sources)) {
      for (const opening of source.match(/<Th\b[^>]*>/gs) ?? []) {
        expect(opening, `${path} が共通Thへ旧指定を重ねている`).not.toMatch(handledByPart)
      }
    }
  })

  it('今回対象外の詳細内テーブルを残し、D-3の旧一覧転送後も基準を締める', () => {
    for (const path of targets.filter((path) => path !== 'app/affiliates/tabs.tsx')) {
      expect(sources[path]).not.toMatch(/<th\b/)
    }
    expect(sources['app/affiliates/tabs.tsx'].match(/<th\b/g)).toHaveLength(20)

    const debt = totals(countDebt().counts) as Record<string, number>
    // 2026-08-29: 統合ユーザー一覧の見出し6つを共通 `Th` へ寄せ、
    // V6の7列へ増やしても直書きを残さなかった。
    // 分析の死んだ旧UIから直書き見出し15個を削除した。現在画面の見出しは
    // 共通の `Th` を通すため、この数へは戻さない。
    // シナリオ一覧と友だち情報欄に加え、対応マークの見出しも共通 `Th` へ寄せた。
    // 2026-09-02: #475 がログインユーザーと入った記録の19見出しを共通Thへ移した。
    // 最新 development との統合後の木を再計測し、237へ締め直す。
    // 2026-09-02: 機能5（シナリオ編集）のコンテンツ表の見出し7個を共通Thへ
    // 寄せ、設計（bV5Vs）の「配信対象」の桁を足しても直書きを増やさなかった。
    // 2026-09-02: 一斉配信の一覧を設計 `q76C35` の6列へ組み直し、見出し8つ
    // （中身は7つで1列ずれていた）を6つにした。直書きの見出しが2つ減るので
    // 両方を統合した木を公式スクリプトで数え直し、228へ締め直す。
    // 2026-09-03: 未使用部品 friend-table・step-editor を消して223。
    // 2026-09-04: 共通情報一覧の6見出しを共通 `Th` へ寄せて217。
    expect(debt['direct-th']).toBe(217)
  })

  it('V5基準・V6優先と画面画像の未検証を契約へ残す', () => {
    const contract = JSON.parse(readFileSync(join(WEB, 'design', 'design-parts.json'), 'utf8'))
    const part = contract.parts.table

    expect(part.status).toBe('active')
    expect(part.routes.v5).toEqual({ '/tags': 'PbCvb' })
    expect(part.routes.v6).toEqual({
      '/reminders': 'kAnOQ',
      '/templates': 'W7LBc',
      '/affiliates': 'BaLte',
      '/conversions': 'Bw4fy',
      '/inflow-links': 'EQS0v',
    })
    expect(part.migration).toEqual({
      directThBefore: 378,
      migratedInThisPr: 75,
      directThRemaining: 303,
    })
    expect(part.visualVerification.status).toBe('unverified')
  })
})
