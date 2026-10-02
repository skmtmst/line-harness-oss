import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * M027：履歴の読込失敗に再試行口なし・送信失敗は原文表示。
 * 履歴の失敗には読み直し口を出し、送信の失敗は共通の状態別案内へ渡す。
 * 応答を失った再送でも履歴で確かめられるよう、送信失敗時は履歴を読み直す。
 */
describe('M027 お問い合わせの失敗表示', () => {
  it('履歴の読込失敗には再試行口がある', () => {
    expect(PAGE).toContain('履歴を読み込めませんでした')
    expect(PAGE).toContain('もう一度読み込む')
    expect(PAGE).not.toContain('>読み込めませんでした。</p>')
  })

  it('送信の失敗は原文のまま出さない', () => {
    expect(PAGE).toContain("describeApiFailure(caught, '送信'")
    expect(PAGE).toContain('お問い合わせの送信はオーナー・管理者・担当者だけができます')
    expect(PAGE).not.toContain("caught.message : '送信できませんでした。もう一度お試しください。'")
  })

  it('送信の失敗時は履歴を読み直す', () => {
    // 確定応答を失った再送でも、履歴に残っているか確かめられるようにする。
    expect(PAGE).toContain('void loadHistory()\n    } finally')
  })
})
