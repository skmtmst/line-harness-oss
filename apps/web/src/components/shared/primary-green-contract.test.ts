import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname, '..', '..')

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(p)
  }
  return out
}

/** 注釈を落とす。直した理由の文が、自分の見張りに当たらないように。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const FILES = sources(SRC).map((p) => ({ p: path.relative(SRC, p), s: code(fs.readFileSync(p, 'utf8')) }))
const CSS = fs.readFileSync(path.join(SRC, 'app', 'globals.css'), 'utf8')

/**
 * 白文字を載せる緑は `--color-accent-deep`（#068a3c・4.46:1）。
 *
 * LINE の緑 #06c755 は白文字で **2.26:1** しかなく、14px 太字に必要な
 * 4.5:1 にまったく届かない。2026-09-03 の決定で、主ボタンは濃いほうへ、
 * LINE の緑は**選択状態・チップ・有効表示に残す**と決めた。
 *
 * 例外は1つ。受信箱の対応状況の札（`chats/page.tsx`）は「選択中」を表すので
 * LINE の緑のまま。ここは押せる札であって主ボタンではない。
 */
describe('白文字を載せる緑', () => {
  it('トークンが決定の色になっている', () => {
    expect(CSS).toContain('--color-accent-deep: #068a3c;')
    expect(CSS, 'LINEの緑は残す').toContain('--color-accent: #06c755;')
  })

  it('LINEの緑に白文字を載せない（選択中の札を除く）', () => {
    const ALLOWED = ['app/chats/page.tsx']
    const hits: string[] = []
    for (const { p, s } of FILES) {
      if (ALLOWED.includes(p)) continue
      for (const line of s.split('\n')) {
        if (!/bg-\[#06[cC]755\]/.test(line)) continue
        if (/text-white|text-on-accent/.test(line)) hits.push(`${p}: ${line.trim().slice(0, 70)}`)
      }
    }
    expect(hits, `bg-accent-deep に変えてください:\n  ${hits.join('\n  ')}`).toEqual([])
  })

  it('受信箱の例外は、選択中の札1つだけ', () => {
    const chats = FILES.find((f) => f.p === 'app/chats/page.tsx')
    expect(chats).toBeDefined()
    const lines = chats!.s.split('\n').filter((l) => /bg-\[#06[cC]755\]/.test(l) && /text-white|text-on-accent/.test(l))
    expect(lines.length, '例外が増えている').toBe(1)
    expect(lines[0], '選択中の札であること').toContain("? 'bg-[#06C755] text-on-accent'")
  })
})
