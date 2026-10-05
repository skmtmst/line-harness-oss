import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

/**
 * 9項目の判定は、同じサーバー結果を正本にする。
 * ブラウザ側で別々のAPIを読み直して判定だけ「正常」に変えると、
 * 保存済みバッジと説明が再び食い違うため、statusを同時に採用する。
 */
describe('運用状態の判定は同じサーバー結果を使う', () => {
  it('9種類のサーバーキーを画面の項目へ対応づける', () => {
    expect(PAGE).toContain("line_connection: 'line'")
    expect(PAGE).toContain("message_quota: 'quota'")
    expect(PAGE).toContain("friend_change: 'friends'")
  })

  it('同じ結果から判定・観測時刻を採用する', () => {
    expect(PAGE).toContain("(result?.status ?? 'unknown')")
    expect(PAGE).toContain('observedAt: result?.observedAt ?? snapshot.lastCheckedAt')
  })

  it('古い結果は正常と表示しない', () => {
    expect(PAGE).toContain("snapshotStatus === 'stale' ? 'unknown'")
  })

  /*
   * A32-01: 期限切れ(stale)の実行結果は、項目ごとの判定にも使わない。
   * 板 Y4LkX1 どおり「古い確認」の札にし、一度も確かめていない
   * （結果が無い）「未確認」とは分ける（古い「正常」が残って健全と
   * 読み違える事故を防ぐ）。
   */
  it('期限切れの実行は項目の判定を古い確認にし、未確認と分ける', () => {
    expect(PAGE).toContain("const snapshotStale = snapshot.overallStatus === 'stale'")
    expect(PAGE).toContain("label: '古い確認'")
    expect(PAGE).toContain('STALE_ITEM_AFTER_MS = 10 * 60 * 1000')
  })

  it('期限切れの帯では自動確認の停止を疑い、確かめ直しへ誘導する', () => {
    expect(PAGE).toContain('前回の確認結果が期限切れです')
    expect(PAGE).toContain('自動確認が止まっている可能性があります')
    expect(PAGE).toContain('いますぐ確かめる')
  })
})
