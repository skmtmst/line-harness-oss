/*
 * 対応が必要な受信の行き先リンクは、見出しの行の右端に1つ
 *（CardHeader の action、actionTone="info"）。
 *
 * 以前は見出しの2行目に独自の文字色・大きさ（text-info text-xs
 * font-semibold）で矢印なしに置いていて、ほかのカードの
 * 「さらに詳しく →」「アクセス解析へ →」「すべて見る →」と見た目が
 * ずれていた。更新時刻はリンクと同じ行に押し込まず、見出しの脇か
 * 別行に残す。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CARD = readFileSync(join(HERE, 'pending-inbox-card.tsx'), 'utf8')

/** 説明の文だけで通ってしまわないよう、判定の前にコメントを落とす。 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('対応が必要な受信の行き先リンク', () => {
  it('CardHeader の action に「受信箱をすべて見る →」を置く', () => {
    const body = code(CARD)
    expect(body).toContain('action={<Link href="/chats"')
    expect(body).toContain('受信箱をすべて見る →')
    expect(body).toContain('actionTone="info"')
  })

  it('見出しの2行目に独自の文字色・大きさのリンクを置かない', () => {
    const body = code(CARD)
    expect(body).not.toContain('受信箱をすべて見る</Link>')
    expect(body).not.toMatch(/text-info text-xs font-semibold/)
  })

  it('更新時刻はリンクと同じ行に押し込まない', () => {
    const body = code(CARD)
    // 更新時刻の行は右寄せの1行で、リンクを含まない。
    expect(body).toContain('justify-end')
    const updateRow = body.slice(body.indexOf('justify-end'))
    expect(updateRow.slice(0, 400)).not.toContain('/chats')
  })
})

describe('対応が必要な受信の表の右端', () => {
  it('状態の列は札の幅に合わせた固定幅にし、残りは内容の列で吸収する', () => {
    const body = code(CARD)
    // 10% の割合指定では狭い幅で札が右の余白へ食い込む。
    expect(body).not.toContain('w-[10%]')
    expect(body).not.toContain('w-[40%]')
    expect(body).toContain('w-24 px-5')
  })

  it('右端の列の右の余白は見出しと同じ px-5 のまま', () => {
    const body = code(CARD)
    expect(body).toContain('<th className="w-[36%] px-5')
  })
})
