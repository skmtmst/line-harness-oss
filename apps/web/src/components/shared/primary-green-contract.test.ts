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
 * 白文字を載せる緑は `--color-accent-deep`（**#087a3e・5.44:1**）。
 *
 * ボタンのラベルは `$size-label` = 13px なので、AA が求めるのは 4.5:1。
 *
 * | 色 | 白文字との比 | |
 * |---|---|---|
 * | `$accent` #06c755 | 2.26:1 | 不合格 |
 * | `$accent-hover` #05b34c | 2.78:1 | 不合格 |
 * | #068a3c | **4.46:1** | 不合格（4.5 に届かない） |
 * | `$accent-deep` #087a3e | **5.44:1** | 合格 |
 *
 * **2026-09-04 に #068a3c から戻した。** 初版の決定は #068a3c だったが、
 * PR #718 で「既存トークン `$accent-deep`(#087A3E) を使い、新しい色トークンは
 * 作らない」に更新された（要件索引 §5-2）。**#068a3c は 4.46:1 で AA にも
 * 届いていない。** 計算して確かめた。
 *
 * LINE の緑 #06c755 は**文字が乗らない用途**——札の地・選択状態・チップ・
 * アイコン・バッジ・有効表示——に残す。
 *
 * 例外は1つ。受信箱の対応状況の札（`chats/page.tsx`）は「選択中」を表すので
 * LINE の緑のまま。ここは押せる札であって主ボタンではない。
 */
describe('白文字を載せる緑', () => {
  it('トークンが決定の色になっている', () => {
    expect(CSS).toContain('--color-accent-deep: #087a3e;')
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

  /*
    生の 16 進だけでなく、**トークンのクラス名でも見る。**
    `bg-accent`（#06c755）や `hover:bg-accent-hover`（#05b34c）に白文字を
    乗せると、押した瞬間だけ 2.78:1 に落ちる。実測で 153 か所あった。
  */
  it('薄い緑のクラスに白文字を乗せない', () => {
    const CLASS_STRINGS = /["'`]([^"'`\n]*)["'`]/g
    const WHITE_TEXT = /\btext-on-accent\b|\btext-white\b/
    // `bg-accent-deep` や `bg-accent-soft` に当てないよう、語の切れ目で見る。
    // `bg-v6-accent`(#07c653) も薄い緑。白文字だと 2.3:1 で、`bg-accent` と同じ。
    const THIN_GREEN = /(?:^|\s)(?:hover:|focus:|active:|group-hover:)?bg-(?:v6-)?accent(?:-hover)?(?=\s|$)/
    const hits: string[] = []
    for (const { p, s } of FILES) {
      for (const m of s.matchAll(CLASS_STRINGS)) {
        const cls = m[1]
        if (WHITE_TEXT.test(cls) && THIN_GREEN.test(cls)) hits.push(`${p}: ${cls.slice(0, 70)}`)
      }
    }
    expect(hits, `bg-accent-deep に変えてください:\n  ${hits.join('\n  ')}`).toEqual([])
  })

  /*
    **共通部品の CSS も見る。** class 名ではなく `var(--color-accent)` で
    書いてあると、上の検査に当たらない。ページ送りの現在地がそれだった
    （白文字が #06c755 に乗って 2.26:1）。
  */
  it('共通部品の CSS でも、薄い緑に白文字を乗せない', () => {
    const dir = path.join(SRC, 'components', 'shared')
    const hits: string[] = []
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.css'))) {
      const css = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      // 宣言のかたまりごとに、地と文字色を突き合わせる
      for (const block of css.split('}')) {
        if (!/color:\s*var\(--color-on-accent\)/.test(block)) continue
        if (/background:\s*var\(--color-accent\)/.test(block)) hits.push(`${name}: ${block.trim().slice(0, 60)}`)
      }
    }
    expect(hits, 'var(--color-accent-deep) にしてください').toEqual([])
  })

  it('受信箱の例外は、選択中の札1つだけ', () => {
    const chats = FILES.find((f) => f.p === 'app/chats/page.tsx')
    expect(chats).toBeDefined()
    const lines = chats!.s.split('\n').filter((l) => /bg-\[#06[cC]755\]/.test(l) && /text-white|text-on-accent/.test(l))
    expect(lines.length, '例外が増えている').toBe(1)
    expect(lines[0], '選択中の札であること').toContain("? 'bg-[#06C755] text-on-accent'")
  })
})
