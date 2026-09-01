import { describe, expect, it } from 'vitest'

import { apiCheckDetail } from './api-check-detail'

describe('健全性チェックのAPI項目', () => {
  it('件数が読めれば桁を区切って出す', () => {
    expect(apiCheckDetail(12345)).toBe(
      '管理APIとEC連携データを確認しました（24時間以内の受信12,345件）',
    )
  })

  it('実値0は0件として出す', () => {
    expect(apiCheckDetail(0)).toContain('受信0件')
  })

  it('読めないときに落ちない。件数も作らない', () => {
    // ここで例外を投げると、6項目まとめて作れず画面が「確認しています…」で止まる。
    for (const bad of [undefined, null, Number.NaN, '12', {}, []]) {
      expect(() => apiCheckDetail(bad)).not.toThrow()
      expect(apiCheckDetail(bad)).toBe('管理APIを確認しました。EC連携の受信件数は読み込めませんでした')
      expect(apiCheckDetail(bad)).not.toContain('件）')
    }
  })
})
