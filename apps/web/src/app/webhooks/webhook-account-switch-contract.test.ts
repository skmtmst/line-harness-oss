import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('Webhook画面のLINEアカウント境界', () => {
  test('読込結果は要求時のアカウントと世代が現在も一致するときだけ反映する', () => {
    expect(source).toContain('const requestGeneration = ++loadGenerationRef.current')
    expect(source).toContain('selectedAccountIdRef.current !== requestAccountId')
    expect(source).toContain('loadGenerationRef.current !== requestGeneration')
  })

  test('一覧を取得したアカウントと現在のアカウントが一致しない操作を拒む', () => {
    expect(source).toContain('loadedAccountId !== requestAccountId')
    expect(source).toContain('LINEアカウントの一覧を読み直してください')
  })

  test('アカウント切替後は古い書込結果で秘密値や一覧を更新しない', () => {
    expect(source).toContain('if (selectedAccountIdRef.current !== requestAccountId) return')
    expect(source).toContain('if (selectedAccountIdRef.current === requestAccountId) await load()')
    expect(source).toContain('setCreatedSecret(null)')
    expect(source).toContain("setInForm({ name: '', sourceType: '', secret: '' })")
  })

  test('更新と削除はAPIの失敗を成功扱いしない', () => {
    expect(source.match(/if \(!res\.success\) return setError\(res\.error\)/g)).toHaveLength(4)
  })
})
