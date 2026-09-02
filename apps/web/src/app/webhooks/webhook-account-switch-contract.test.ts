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
    // 有効・無効の切り替えは受信・送信の2か所。
    expect(source.match(/if \(!res\.success\) return setError\(res\.error\)/g)).toHaveLength(2)
    /*
      削除は確認窓へ移した（`confirm()` をやめた）。失敗しても窓を閉じずに
      運用者の言葉で出すため、`setError` ではなく投げて受け止める。
      受信・送信は同じ経路にまとめたので1か所。
    */
    expect(source.match(/if \(!res\.success\) throw new Error\(res\.error\)/g)).toHaveLength(1)
    expect(source).toContain('Webhookを削除できませんでした。')
  })
})
