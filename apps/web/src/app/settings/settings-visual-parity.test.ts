import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 描画は page.tsx、動き（読み込み・保存・競合）は use-feature-settings.ts にある。
// 両方を合わせて1つの画面として見る。
const dir = dirname(fileURLToPath(import.meta.url))
const source = [
  readFileSync(join(dir, 'feature-settings-v8.tsx'), 'utf8'),
  readFileSync(join(dir, 'use-feature-settings.ts'), 'utf8'),
].join('\n')

describe('機能設定の添付デザイン', () => {
  it('利用数は後から読み、失敗時は読み直せる', () => {
    // 重い集計で設定の表示を待たせない。以前は Promise.all で一緒に待っていた。
    expect(source).toContain('const loadUsage = useCallback')
    expect(source).toContain('void loadUsage()')
    expect(source).toContain('usageFailed')
    expect(source).toContain('利用数を読み直す')
    expect(source).not.toContain('usageOverview(selectedAccountId).catch(() => null)')
  })

  it('保存後はサーバ値を読み直して確定する', () => {
    // 無効環境でサーバーが正した値（飲食店テストなど）をオン表示のままにしない。
    expect(source).toContain('サーバ値を読み直して確定')
    expect(source).toContain('setFeatures(serverFeatures)')
    expect(source).toContain('setSavedFeatures(serverFeatures)')
  })

  it('変更ありの判定は画面に出ないキーも比べる', () => {
    expect(source).toContain('featureSettingsAreDirty({')
    expect(source).toContain('normalizeFeatureSettings(response.data.features)')
  })
})
