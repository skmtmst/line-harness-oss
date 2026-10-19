import { describe, expect, it } from 'vitest'
import { operatorPathLabel, operatorPathNote } from '../../v8/emergency/send-path-coverage-panel'

/* 停止が届く送信経路：台帳の作り手向けの語を運用者の画面に出さない。 */
describe('送信経路の言葉', () => {
  it('題から cron・manual 指定・送信の方式名を外す', () => {
    expect(operatorPathLabel('シナリオ配信（cron）')).toBe('シナリオ配信')
    expect(operatorPathLabel('プロキシ経由の担当者個別返信（manual 指定）')).toBe('プロキシ経由の担当者個別返信（担当者の返信として送ったもの）')
    expect(operatorPathLabel('プロキシ経由の自動 push・multicast・broadcast')).toBe('プロキシ経由の自動送信')
  })
  it('ヘッダ名の補足は運用の言葉に置き換え、作り手向けの補足は出さない', () => {
    expect(operatorPathNote('X-Line-Harness-Source: manual を付けた1対1 push は手動返信と同じく対象外です。')).not.toMatch(/X-Line|manual|push/)
    expect(operatorPathNote('停止中は実行行を claim しない。claim 済みの行は queued へ戻す。')).toBeNull()
    expect(operatorPathNote('束と束のあいだで止まる。')).toBe('束と束のあいだで止まる。')
    expect(operatorPathNote(null)).toBeNull()
  })
})
