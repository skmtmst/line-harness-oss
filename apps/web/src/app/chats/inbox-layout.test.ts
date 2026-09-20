/*
 * LAY-01(#982): 受信箱の3列（一覧・トーク・顧客情報）が画面内に
 * 収まるかの実値検証。
 *
 * 追加監査で確認された不足幅（メニュー256px＋左右余白80px＋外枠2pxを
 * 引いた本文領域で計算）を、そのまま合格条件にする。
 */
import { describe, expect, it } from 'vitest'
import {
  INBOX_INFO_PANEL_MIN_VIEWPORT,
  inboxThreeColumnsFit,
} from './inbox-layout'

describe('受信箱の3列が収まる画面幅', () => {
  it('常設を始める境界（1536px = Tailwind 2xl）で3列が収まる', () => {
    expect(INBOX_INFO_PANEL_MIN_VIEWPORT).toBe(1536)
    expect(inboxThreeColumnsFit(INBOX_INFO_PANEL_MIN_VIEWPORT)).toBe(true)
  })

  it('監査で右に切れていた幅では3列を常設しない（ドロワー側へ回す）', () => {
    for (const width of [1280, 1440]) {
      expect(inboxThreeColumnsFit(width)).toBe(false)
    }
  })

  it('常設する幅のどこでも3列が収まる（1536pxで再び不足しない）', () => {
    for (const width of [1536, 1674, 1920]) {
      expect(inboxThreeColumnsFit(width)).toBe(true)
    }
  })
})
