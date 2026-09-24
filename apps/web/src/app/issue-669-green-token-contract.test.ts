import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname)

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) sources(p, out)
    else if (/\.tsx$/.test(e.name) && !e.name.includes('.test.')) out.push(p)
  }
  return out
}

/*
 * #669 監査A7「緑の意味過多」。
 * v6-common-rules「緑はオン・正常・主要な1つにだけ使う」の画面側の約束：
 * 押すもの（リンク・文字ボタン・折りたたみ）は `text-action` の青、
 * 緑は塗りの主操作・選択中・成功/有効状態だけに残す。
 * JSX が複数行に分かれてタグ名を逃しても、下線つきの緑文字は
 * 「押せそう」に見えるので同じく禁止する。
 */
const files = sources(SRC).map((p) => ({
  p: path.relative(SRC, p),
  lines: fs.readFileSync(p, 'utf8').split('\n'),
}))

const offenders = (test: (line: string) => boolean) =>
  files.flatMap((f) =>
    f.lines.flatMap((line, i) => (test(line) ? [`${f.p}:${i + 1}`] : [])),
  )

describe('緑トークンの意味（#669 A7）', () => {
  it('リンク・a要素に text-accent-deep を付けない（リンクはリンク色）', () => {
    const hits = offenders(
      (l) => /<Link|<a\s/.test(l) && l.includes('text-accent-deep') && !/bg-accent|border-accent/.test(l),
    )
    expect(hits, `text-action へ直す: ${hits.join(', ')}`).toEqual([])
  })

  it('下線つき文字に text-accent-deep を付けない（押せる見た目は青）', () => {
    const hits = offenders(
      (l) => l.includes('text-accent-deep') && /hover:underline|\bunderline\b/.test(l) && !/bg-accent|border-accent/.test(l),
    )
    expect(hits, `text-action へ直す: ${hits.join(', ')}`).toEqual([])
  })

  it('hover で緑になるリンク色を残さない', () => {
    const hits = offenders((l) => l.includes('hover:text-accent-deep'))
    expect(hits, `hover:text-action へ直す: ${hits.join(', ')}`).toEqual([])
  })

  it('情報帯の青背景に緑文字を重ねない（bg-info-bg には text-info）', () => {
    const hits = offenders((l) => l.includes('bg-info-bg') && l.includes('text-accent-deep'))
    expect(hits, `text-info へ直す: ${hits.join(', ')}`).toEqual([])
  })
})
