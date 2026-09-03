import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname, '..', '..')
const BAR = fs.readFileSync(path.join(__dirname, 'sticky-bar.tsx'), 'utf8')
const CSS = fs.readFileSync(path.join(__dirname, 'sticky-bar.module.css'), 'utf8')

/**
 * **作成・編集画面の下の帯を、部品で1つにそろえる。**
 *
 * 設計 `bV5Vs`（シナリオ編集）と `XBkiQ`（保存した検索を編集）は
 * どちらも同じ形——**左端に赤い削除、中央に「キャンセル / 複製して保存 /
 * 変更を保存」、右端は空き。**
 *
 * **消す操作を保存の隣に置かない。** 隣にあると、押し間違いが
 * 「保存したつもりが消えていた」になる。離すのは見た目の好みではない。
 *
 * 画面ごとに帯を書くと、この距離がそのつど変わる。部品で固定する。
 */

function pages(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) pages(p, out)
    else if (e.name === 'page.tsx') out.push(p)
  }
  return out
}

const EDIT_PAGES = pages(path.join(SRC, 'app'))
  .map((p) => ({
    p: path.relative(path.join(SRC, 'app'), p).split(path.sep).join('/'),
    s: fs.readFileSync(p, 'utf8'),
  }))
  .filter((f) => /\/(new|edit)\/page\.tsx$/.test(f.p))

/**
 * **まだ帯を使っていない作成・編集画面。減る一方の表。**
 *
 * 帯へ寄せるのは画面ごとの作業で、担当は S1〜S3（`docs/v6-parallel-plan.md`
 * §4「守ること」で S0 は機能の画面を触らない）。ここは**増やせないこと**
 * だけを見張る。使い始めたら行ごと消す——消し忘れるとこの試験が落ちる。
 *
 * 2026-09-04 時点で 24 画面。
 */
const NOT_YET = [
  'accounts/new/page.tsx',
  'auto-replies/edit/page.tsx',
  'booking/bookings/new/page.tsx',
  'broadcasts/new/page.tsx',
  'contents/vars/edit/page.tsx',
  'contents/vars/new/page.tsx',
  'events/edit/page.tsx',
  'events/new/page.tsx',
  'form-submissions/edit/page.tsx',
  'nen-campaigns/columns/new/page.tsx',
  'nen-campaigns/edit/page.tsx',
  'reminders/edit/page.tsx',
  'restaurant-test/stores/new/page.tsx',
  'rich-menus/edit/page.tsx',
  'rich-menus/new/page.tsx',
  'scoring/new/page.tsx',
  'tags/edit/page.tsx',
  'tags/folders/new/page.tsx',
  'tags/marks/edit/page.tsx',
  'tags/marks/new/page.tsx',
  'templates/edit/page.tsx',
  'templates/questions/new/page.tsx',
  'webinars/edit/page.tsx',
  'webinars/new/page.tsx',
]

const uses = (s: string) => /StickyBar|CreatePage/.test(s)

describe('下部追従バーの並びを部品で固定する', () => {
  it('作成・編集画面を読めている', () => {
    expect(EDIT_PAGES.length).toBeGreaterThanOrEqual(30)
  })

  it('帯を使っていない画面を増やさない', () => {
    const found = EDIT_PAGES.filter((f) => !uses(f.s)).map((f) => f.p).sort()
    expect(found, '作成・編集画面が自前で帯を書いている').toEqual([...NOT_YET].sort())
  })

  it('削除は左端、ほかは中央、右端は空ける', () => {
    // 3列にして真ん中を auto にする。`space-between` だと、削除が無い画面で
    // 操作が左へ寄ってしまう。
    expect(CSS).toMatch(/grid-template-columns:\s*1fr auto 1fr/)
    expect(CSS).not.toMatch(/justify-content:\s*space-between/)
    expect(CSS).toMatch(/\.actions\s*\{[^}]*justify-content:\s*center/s)
    // 削除は専用の口で受ける。状態の文字と同じ口に入れない。
    expect(BAR).toMatch(/destructive\?:\s*ReactNode/)
    expect(BAR).toMatch(/\{destructive\}/)
  })

  it('状態の文字は無くてよい', () => {
    // 設計の2画面（bV5Vs・XBkiQ）はどちらも状態の文字を持たない。
    expect(BAR).toMatch(/status\?:\s*ReactNode/)
    expect(BAR).toMatch(/status \? </)
  })

  it('1440 で横スクロールさせずに折り返す', () => {
    expect(CSS).toMatch(/@media \(max-width: 1100px\)/)
  })
})
