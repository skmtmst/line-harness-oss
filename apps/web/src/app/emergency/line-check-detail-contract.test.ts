import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

/**
 * LINE接続を含む6項目の判定と本文は、同じサーバー結果を正本にする。
 * ブラウザ側で別々のAPIを読み直して本文だけ「正常」に変えると、
 * 保存済みバッジと説明が再び食い違うため、summary/statusを同時に採用する。
 */
describe('運用状態の本文とバッジは同じサーバー結果を使う', () => {
  it('6種類のサーバーキーを画面の項目へ対応づける', () => {
    expect(PAGE).toContain("line_connection: 'line'")
    expect(PAGE).toContain("message_quota: 'quota'")
    expect(PAGE).toContain("friend_change: 'friends'")
  })

  it('同じ結果から本文・判定・観測時刻を採用する', () => {
    expect(PAGE).toContain("detail: result?.summary ?? 'サーバーに確認記録がありません'")
    expect(PAGE).toContain("severity: result?.status ?? 'unknown'")
    expect(PAGE).toContain('observedAt: result?.observedAt ?? snapshot.lastCheckedAt')
  })

  it('古い結果は正常と表示しない', () => {
    expect(PAGE).toContain("snapshotStatus === 'stale' ? 'unknown'")
  })
})
