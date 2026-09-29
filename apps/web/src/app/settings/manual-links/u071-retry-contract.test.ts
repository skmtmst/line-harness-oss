import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/** #975 U071: 初回の読み込み失敗にも再試行を付ける。 */
describe('マニュアル正本表の再試行（#975 U071）', () => {
  it('読み込み失敗に「もう一度読み込む」がある', () => {
    expect(PAGE).toContain('onRetry={status === \'error\' ? () => void loadInitial(() => true) : undefined}')
    expect(PAGE).toContain('正本表を読み込めませんでした')
    expect(PAGE).toContain('const loadInitial = useCallback')
  })
})
