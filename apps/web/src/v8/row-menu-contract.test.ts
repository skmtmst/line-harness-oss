import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 行の右端の「…」は共通の RowMenu（components/shared/row-actions.tsx）だけで作る
 * （2026-10-08 共通部品の1本化）。開く位置・Esc／外で閉じる・矢印・危ない操作は
 * 赤字で区切りの下、は部品の中で決めてあるので、画面で3点の印と ActionMenu を
 * 自分で組み合わせると、その決まりから外れる。
 *
 * 見張り：src/v8 の画面で、3点の印（MoreHorizontal・MoreVertical・Ellipsis・MoreAction）と
 * ActionMenu を同じファイルで描いていないこと。
 */
const ROOT = __dirname
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
const screens = files(ROOT).filter((f) => f.endsWith('.tsx') && !/\.test\.tsx?$/.test(f))

/** 「…」ではない3点（メニューを開かない・別の作業役の担当）。理由を書いて足す。 */
const ALLOW: Record<string, string> = {
  // テンプレートの編集の差し込みの段。今回の1本化の対象外（司令塔 2026-10-08）。
  'template-edit/insert-row.tsx': '対象外（司令塔 2026-10-08）',
}

const DOTS = /\b(MoreHorizontal|MoreVertical|EllipsisVertical|Ellipsis|MoreAction)\b/
const OWN_MENU = /<ActionMenu\b/

describe('「…」は共通の RowMenu で作る', () => {
  it('画面で3点の印と ActionMenu を組み合わせない', () => {
    const bad = screens
      .map((f) => relative(ROOT, f))
      .filter((rel) => !(rel in ALLOW))
      .filter((rel) => {
        const src = readFileSync(join(ROOT, rel), 'utf8')
        return DOTS.test(src) && OWN_MENU.test(src)
      })
    expect(bad).toEqual([])
  })

  it('見張りが空振りしていない（RowMenu を使う画面を拾える）', () => {
    const users = screens.filter((f) => /\bRowMenu\b/.test(readFileSync(f, 'utf8')))
    expect(users.length).toBeGreaterThanOrEqual(40)
  })
})
