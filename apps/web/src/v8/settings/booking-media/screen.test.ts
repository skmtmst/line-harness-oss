/*
 * 予約サイト・グルメ媒体（提案 E-4）の入力の確かめと札の試験。URL は https だけ・ID とパスワードの入った URL は断る。
 */
import { describe, expect, it } from 'vitest'
import { checkHttpsUrl, gourmetCode, importBadge, recipientText, shortUrl } from './screen'

describe('予約サイト・グルメ媒体', () => {
  it('URL は https だけ。空は消す。ID・パスワード入りは断る', () => {
    expect(checkHttpsUrl('https://owner.tabelog.com/')).toEqual({ ok: true, value: 'https://owner.tabelog.com/' })
    expect(checkHttpsUrl('  ')).toEqual({ ok: true, value: null })
    expect(checkHttpsUrl('http://owner.tabelog.com/').ok).toBe(false)
    expect(checkHttpsUrl('https://user:pass@owner.tabelog.com/').ok).toBe(false)
    expect(checkHttpsUrl('tabelog').ok).toBe(false)
  })

  it('表の URL は https:// を省く', () => {
    expect(shortUrl('https://g.page/nen-ginza')).toBe('g.page/nen-ginza')
  })

  it('予約メールの取り込みの札：グルメ媒体は取り込まない・Google は連携・届いていない日数', () => {
    expect(importBadge({ code: 'retty', acceptsReservations: false }, undefined).label).toBe('取り込まない')
    expect(importBadge({ code: 'google', acceptsReservations: true }, undefined).label).toBe('Google ビジネスと連携')
    expect(importBadge({ code: 'hotpepper', acceptsReservations: true }, { code: 'hotpepper', status: 'receiving' }).label).toBe('取り込み中')
    expect(importBadge({ code: 'gurunavi', acceptsReservations: true }, { code: 'gurunavi', status: 'not_receiving', daysWithoutReceipt: 7 }).label).toBe('7日届いていません')
    expect(importBadge({ code: 'ikyu', acceptsReservations: true }, { code: 'ikyu', status: 'preparing' }).label).toBe('未設定')
  })

  it('グルメ媒体のコードは口の形（gourmet_ と英小文字・数字）', () => {
    expect(gourmetCode(1_700_000_000_000)).toMatch(/^gourmet_[a-z0-9_]{1,50}$/)
  })

  it('知らせる相手：当日の責任者・店長・選んだスタッフ（名前と人数）', () => {
    const members = [{ id: 'm1', staff_name: '店長' }, { id: 'm2', staff_name: 'ホール責任者' }]
    expect(recipientText({ recipientMode: 'responsible', membershipIds: [] }, members)).toBe('当日の責任者（いなければ店長）')
    expect(recipientText({ recipientMode: 'manager', membershipIds: [] }, members)).toBe('店長')
    expect(recipientText({ recipientMode: 'selected', membershipIds: ['m1', 'm2'] }, members)).toBe('店長・ホール責任者（2人）')
    expect(recipientText({ recipientMode: 'selected', membershipIds: ['gone'] }, members)).toBe('選んだスタッフ（1人）')
  })
})
