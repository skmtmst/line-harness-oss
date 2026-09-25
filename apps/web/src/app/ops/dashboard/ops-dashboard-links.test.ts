/*
 * 運用ダッシュボードの見出し右の行き先リンクにも矢印を付ける。
 * 行き先リンクは「見る →」「すべて見る →」の形にそろえる。
 */

import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('運用ダッシュボードの行き先リンク', () => {
  it('お問い合わせの「すべて見る」に矢印を付ける', () => {
    expect(PAGE).toContain('>すべて見る →</Link>')
    expect(PAGE).not.toContain('>すべて見る</Link>')
  })
})
