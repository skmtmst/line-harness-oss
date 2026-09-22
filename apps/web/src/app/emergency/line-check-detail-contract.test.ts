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
    expect(PAGE).toContain("'サーバーに確認記録がありません'")
    expect(PAGE).toContain("(result?.status ?? 'unknown')")
    expect(PAGE).toContain('observedAt: result?.observedAt ?? snapshot.lastCheckedAt')
  })

  it('古い結果は正常と表示しない', () => {
    expect(PAGE).toContain("snapshotStatus === 'stale' ? 'unknown'")
  })

  /*
   * A32-01: 期限切れ(stale)の実行結果は、項目ごとの判定にも使わない。
   * 全体バナーだけでなく各行も「未確認」へ倒し、本文には古い結果である
   * ことを明示する（古い「正常」が残って健全と読み違える事故を防ぐ）。
   */
  it('期限切れの実行は項目の判定を未確認へ倒し、古い結果と明示する', () => {
    expect(PAGE).toContain("const stale = snapshot.overallStatus === 'stale'")
    expect(PAGE).toContain("severity: stale ? 'unknown' : (result?.status ?? 'unknown')")
    expect(PAGE).toContain('古い結果です（再確認待ち）')
  })

  it('期限切れのときは過去の「次回予定」を案内しない', () => {
    expect(PAGE).toContain("'期限切れ（再確認待ち）'")
    expect(PAGE).toContain('自動確認が止まっている可能性があります')
  })
})
