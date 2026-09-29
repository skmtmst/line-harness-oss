import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('リッチメニュー編集中の表示', () => {
  it('選択中の面だけを編集中と明記する', () => {
    expect(PAGE).toContain('{active && <span className="ml-1 text-xs opacity-80">編集中</span>}')
  })
})
