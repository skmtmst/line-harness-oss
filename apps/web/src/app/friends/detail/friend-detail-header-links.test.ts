/*
 * 友だち詳細の節の見出し右の行き先リンクにも矢印を付ける。
 * 行き先リンクは「〜を見る →」の形にそろえる。
 */

import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('友だち詳細の行き先リンク', () => {
  it('マイルの「詳細を見る」に矢印を付ける', () => {
    expect(PAGE).toContain('>詳細を見る →</Link>')
  })
})
