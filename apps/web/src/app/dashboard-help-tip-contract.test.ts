/*
 * 見出しの脇の「？」は shared の HelpTip に一本化する（★V7・2026-09-27）。
 *
 * ダッシュボード専用の枠なし HelpTip（`components/dashboard/help-tip.tsx`）
 * は廃止した。丸・楕円・枠なしは使わず、18px の角丸の正方形にそろえる。
 * 題は1行のままにし、period と helpTip の両方は置かない。
 * （動きを守る試験ではないため、見た目の付け替えに合わせて書き換えた。
 * 題をふさがず補足だけを入れる、という意図は残す。）
 */

import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const DASHBOARD_HELP_TIP = path.join(__dirname, '..', 'components', 'dashboard', 'help-tip.tsx')
const SIDE_CARDS = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'dashboard', 'side-cards.tsx'),
  'utf8',
)

describe('見出しの脇の HelpTip', () => {
  it('ダッシュボード専用の HelpTip は置かず、shared の HelpTip を使う', () => {
    expect(fs.existsSync(DASHBOARD_HELP_TIP)).toBe(false)
    expect(SIDE_CARDS).toContain("from '@/components/shared/help-tip'")
    expect(SIDE_CARDS).not.toContain('dashboard/help-tip')
  })

  it('SideCard は helpTip を中身（children）で渡し、題のすぐ後ろに出す', () => {
    expect(SIDE_CARDS).toContain('helpTip?: string')
    expect(SIDE_CARDS).toContain('<HelpTip label={`${title}の説明`}>{helpTip}</HelpTip>')
    expect(SIDE_CARDS).not.toContain('<HelpTip text=')
  })

  it('題と「？」はひとかたまりで文字の縦の中央にそろえ、period と両方は置かない設計にする', () => {
    expect(SIDE_CARDS).toContain('items-center gap-1')
    expect(SIDE_CARDS).toContain('period と両方は置かない')
  })
})
