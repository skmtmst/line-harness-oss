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

/**
 * 画面が読み込んでいるものも一緒に見る。
 *
 * **帯は部品の中にあることがある。** `tags/edit` は
 * `components/friend-fields/edit-tag-page-v4.tsx` に、
 * `tags/marks/new` は `support-mark-editor.tsx` に本体がある。
 * `page.tsx` だけを読むと「帯が無い」ことになり、直しようがない。
 */
function readWithParts(file: string, depth = 0, seen = new Set<string>()): string {
  if (depth > 2 || seen.has(file)) return ''
  seen.add(file)
  let source: string
  try {
    source = fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
  let combined = source
  for (const m of source.matchAll(/from '@\/(components|app|lib)\/([^']+)'/g)) {
    const base = path.join(SRC, m[1], m[2])
    for (const ext of ['.tsx', '.ts', '/index.tsx']) {
      if (fs.existsSync(base + ext)) {
        combined += readWithParts(base + ext, depth + 1, seen)
        break
      }
    }
  }
  for (const m of source.matchAll(/from '\.\/([^']+)'/g)) {
    const base = path.join(path.dirname(file), m[1])
    for (const ext of ['.tsx', '.ts']) {
      if (fs.existsSync(base + ext)) {
        combined += readWithParts(base + ext, depth + 1, seen)
        break
      }
    }
  }
  return combined
}

/**
 * 転送だけの画面は数えない。
 *
 * **帯を置けないものを「まだ置いていない」と数えない。** `scoring/new` は
 * `/mileage/earning-rules/new` へ送るだけで、フォームも保存も無い。
 * 表に残すと永久に空にならず、見張りとして働かなくなる。
 */
function isRedirectOnly(source: string): boolean {
  return /\b(permanentRedirect|redirect)\(/.test(source) && !/<form|onSubmit|保存/.test(source)
}

const EDIT_PAGES = pages(path.join(SRC, 'app'))
  .map((p) => ({
    p: path.relative(path.join(SRC, 'app'), p).split(path.sep).join('/'),
    s: readWithParts(p),
    own: fs.readFileSync(p, 'utf8'),
  }))
  .filter((f) => /\/(new|edit)\/page\.tsx$/.test(f.p))
  .filter((f) => !isRedirectOnly(f.own))

/**
 * **まだ帯を使っていない作成・編集画面。減る一方の表。**
 *
 * 帯へ寄せるのは画面ごとの作業で、担当は S1〜S3（`docs/v6-parallel-plan.md`
 * §4「守ること」で S0 は機能の画面を触らない）。ここは**増やせないこと**
 * だけを見張る。使い始めたら行ごと消す——消し忘れるとこの試験が落ちる。
 *
 * 2026-09-04: 24 画面と数えていたが、**数え方が2つ間違っていた**（台帳 #109）。
 *   転送するだけの画面（`accounts/new` `scoring/new`）を数えていた。
 *     置けないものを「まだ置いていない」と数えると、表が永久に空にならない。
 *   帯が部品の中にある画面（`tags/edit` `tags/marks/*` `events/new`
 *     `templates/edit`）を「無い」と数えていた。`page.tsx` だけ読んでいたため。
 * 読み込んだ部品まで見て数え直し、17 画面。
 */
const NOT_YET = [
  'auto-replies/edit/page.tsx',
  'booking/bookings/new/page.tsx',
  'broadcasts/new/page.tsx',
  'events/edit/page.tsx',
  'form-submissions/edit/page.tsx',
  'nen-campaigns/columns/new/page.tsx',
  'nen-campaigns/edit/page.tsx',
  'restaurant-test/stores/new/page.tsx',
  'rich-menus/edit/page.tsx',
  'rich-menus/new/page.tsx',
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
