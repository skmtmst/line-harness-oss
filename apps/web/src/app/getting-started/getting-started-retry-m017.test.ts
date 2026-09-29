import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * M017：順路の読み込み失敗時に再試行口がない。
 * 捕まえた失敗を共通部品へ渡し、読み直し口を出す。
 * 403 は共通部品が権限の案内にし、再試行口を出さない。
 */
describe('M017 はじめの設定の読み込み失敗の再試行口', () => {
  it('読み込み失敗面に再試行口があり、押すと読み直す', () => {
    expect(PAGE).toContain('error={status === \'error\' ? loadError : undefined}')
    expect(PAGE).toContain('onRetry={() => void load()}')
  })

  it('読み直しは読み込み処理に結ばれている', () => {
    expect(PAGE).toContain('const load = useCallback(async ()')
    expect(PAGE).toContain('setLoadError(')
  })
})
