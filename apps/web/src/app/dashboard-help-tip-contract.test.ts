/*
 * 見出しの脇の「？」（HelpTip）は、題の脇をふさがず補足だけを入れる。
 *
 * ダッシュボード右列の「今月の送信枠」は、題の脇に「毎月1日リセット」を
 * 置いたため題が2行に折れていた。補足は HelpTip へ移し、題は1行のままにする。
 * period と helpTip の両方は置かない。
 */

import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const HELP_TIP = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'dashboard', 'help-tip.tsx'),
  'utf8',
)
const SIDE_CARDS = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'dashboard', 'side-cards.tsx'),
  'utf8',
)

describe('見出しの脇の HelpTip', () => {
  it('HelpTip は text と label の形で置く（本線の一本化に備える）', () => {
    expect(HELP_TIP).toContain('text: string')
    expect(HELP_TIP).toContain("label = '補足を見る'")
    expect(HELP_TIP).toContain('role="tooltip"')
  })

  it('SideCard は helpTip を題のすぐ後ろに出し、period と両方は置かない設計にする', () => {
    expect(SIDE_CARDS).toContain('helpTip?: string')
    expect(SIDE_CARDS).toContain('<HelpTip text={helpTip} />')
    expect(SIDE_CARDS).toContain('period と両方は置かない')
  })

  it('HelpTip はトークンの色だけを使い、素の色や新しい影を作らない', () => {
    expect(HELP_TIP).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(HELP_TIP).toContain('border-hairline')
    expect(HELP_TIP).toContain('shadow-float')
  })
})
