import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('V6 一斉配信詳細の契約', () => {
  it('配信内容を見る操作を、同じ画面の送信内容へ接続する', () => {
    expect(PAGE).toContain("contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })")
    expect(PAGE).toContain('id="broadcast-content"')
    expect(PAGE).not.toContain('配信内容の別画面は準備中です')
  })

  it('配信が読めるまでは内容への操作を押せない', () => {
    expect(PAGE).toContain('disabled={!broadcast}')
  })
})
