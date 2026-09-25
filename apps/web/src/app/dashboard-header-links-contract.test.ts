/*
 * ダッシュボードの行き先リンクは、カードの右上（見出しの行の右端）に1つ。
 * 更新時刻は右下にそろえる。
 *
 * 「今月の送信枠」の「配信設定へ →」は下の行、「運用アラート」の
 * 「運用状態を見る →」は左下に置いていて、カードごとに場所が違った。
 * どちらも SideCard の action（右上）へ移し、更新時刻は右下へそろえる。
 * 「毎月1日リセット」はリンクの場所をふさぐので見出しの脇の小さい文字へ。
 *
 * 見た目は1つにそろえる。CardHeader の action（actionTone="info"）と
 * 同じ色・大きさ（status-info・13px・semibold・矢印付き）にし、
 * 独自の色・大きさを増やさない。
 */

import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const SIDE_CARDS = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'dashboard', 'side-cards.tsx'),
  'utf8',
)

/** 注釈を落とす。「なぜ直したか」を書いた文が、直したはずの字面に当たるのを避ける。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const CODE = code(PAGE)
const SIDE = code(SIDE_CARDS)

/** 行き先リンクの単一の見た目。 */
const SINGLE_LOOK = 'text-status-info'

describe('ダッシュボードの行き先リンクの置き場所', () => {
  it('今月の送信枠は SideCard で右上に「配信設定へ →」、脇に「毎月1日リセット」', () => {
    expect(CODE).toContain('title="今月の送信枠"')
    expect(CODE).toContain('period="毎月1日リセット"')
    expect(CODE).toContain("action={{ label: '配信設定へ →', href: '/accounts' }}")
  })

  it('運用アラートは SideCard で右上に「運用状態を見る →」、脇の「現在」は残す', () => {
    expect(CODE).toContain('title="運用アラート"')
    expect(CODE).toContain('period="現在"')
    expect(CODE).toContain("action={{ label: '運用状態を見る →', href: '/emergency' }}")
  })

  it('行き先リンクを下の行や左下に置かない', () => {
    // 下の行にリンクと更新時刻を並べていた残骸がないこと。
    expect(CODE).not.toMatch(/配信設定へ →<\/Link>/)
    expect(CODE).not.toMatch(/運用状態を見る →<\/Link>/)
  })
})

describe('ダッシュボードの行き先リンクの見た目', () => {
  it('SideCard の action は CardHeader（actionTone="info"）と同じ見た目', () => {
    expect(SIDE).toContain(SINGLE_LOOK)
    expect(SIDE).toContain('text-label font-semibold')
    expect(SIDE).not.toMatch(/text-info shrink-0 text-xs/)
  })

  it('LiveDataCard の行き先リンクは同じ見た目で矢印付き', () => {
    expect(CODE).toContain('{linkLabel} →</Link>')
    expect(CODE).toContain('text-status-info shrink-0 text-label font-semibold')
  })

  it('TodayTaskCard の行き先リンクは同じ見た目（配置は右下のまま）', () => {
    expect(CODE).toContain('text-status-info inline-flex min-h-6')
    expect(CODE).not.toMatch(/text-action inline-flex min-h-6/)
  })

  it('ダッシュボードに独自の色・大きさの行き先リンクを増やさない', () => {
    expect(CODE).not.toMatch(/text-action shrink-0 text-xs hover:underline/)
    expect(CODE).not.toMatch(/text-info shrink-0 text-xs/)
  })
})
