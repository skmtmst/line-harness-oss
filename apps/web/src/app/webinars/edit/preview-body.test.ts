import { describe, expect, it } from 'vitest'
import type { Webinar } from '@/lib/api'
import { ctaPreview, notificationPreview, videoPreview } from './preview-body'

const webinar = (over: Partial<Webinar> = {}): Webinar => ({
  id: 'webinar-1', accountId: 'acc-1', title: 'NEN活用スタートセミナー', slug: 'nen-start',
  status: 'active', videoPrefix: 'webinars/nen-start', durationSeconds: 2538,
  schedule: [], cta: null, ...over,
} as Webinar)

describe('LINEプレビューの中身', () => {
  it('動画が設定されていれば、起きることを書く', () => {
    expect(videoPreview(webinar()).body).toContain('視聴状況が友だちごとに記録されます')
  })

  it('入力が無いときに、それらしい文を作らない', () => {
    /*
      見本を置くと、保存すればそれが届くと読めてしまう。
      何を入れれば埋まるかだけを書く。
    */
    const v = videoPreview(webinar({ videoPrefix: null }))
    expect(v.body).toBeNull()
    expect(v.empty).toContain('動画を設定すると')
  })

  it('CTAはボタンの文言をそのまま見せる', () => {
    const c = ctaPreview(webinar({ cta: { label: '個別相談を予約する', url: 'https://x', showAtSeconds: 0 } } as Partial<Webinar>))
    expect(c.buttonLabel).toBe('個別相談を予約する')
    expect(c.body).toContain('動画の下にボタンが出ます')
  })

  it('CTAが空ならボタンを出さない', () => {
    const c = ctaPreview(webinar({ cta: { label: '   ', url: '', showAtSeconds: 0 } } as Partial<Webinar>))
    expect(c.buttonLabel).toBeNull()
    expect(c.body).toBeNull()
  })

  it('通知は実際に送る文をそのまま見せる', () => {
    expect(notificationPreview('明日20:00に始まります').body).toBe('明日20:00に始まります')
  })

  it('通知が空でも文を作らない', () => {
    for (const v of [null, undefined, '   ']) {
      expect(notificationPreview(v).body).toBeNull()
    }
  })

  it('設計の見本文を固定値で置かない', () => {
    // 設計画像の文をそのまま埋め込むと、入力と関係なく出てしまう。
    const c = ctaPreview(webinar())
    expect(c.buttonLabel).not.toBe('個別相談を予約する')
  })
})
