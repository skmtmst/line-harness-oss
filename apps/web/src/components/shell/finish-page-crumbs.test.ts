import { describe, expect, it } from 'vitest'
import { finishPageCrumbs } from './app-top-bar'

/* 2026-10-15 判定役：上の帯のパンくずの重複と「設定」の段の抜け。 */
describe('上の帯のパンくずの仕上げ', () => {
  it('画面名と同じ名前の段は出さない（予約設定 › 予約設定 にしない）', () => {
    expect(finishPageCrumbs('/booking/menus', [{ label: '予約設定' }], '予約設定')).toBeNull()
  })

  it('設定の組の画面は手前に「設定」を置く', () => {
    expect(finishPageCrumbs('/line-notifications', null, 'LINE通知')).toEqual([{ label: '設定', href: '/settings' }])
    expect(finishPageCrumbs('/emergency', null, '運用状態')).toEqual([{ label: '設定', href: '/settings' }])
    expect(finishPageCrumbs('/pools/new', [{ label: 'プール管理', href: '/pools' }], 'プールを作る'))
      .toEqual([{ label: '設定', href: '/settings' }, { label: 'プール管理', href: '/pools' }])
  })

  it('「機能設定」の段や画面が渡した「設定」と二重にしない', () => {
    expect(finishPageCrumbs('/settings/file-scan', [{ label: '機能設定', href: '/settings' }], 'ファイルの検査'))
      .toEqual([{ label: '設定', href: '/settings' }])
    expect(finishPageCrumbs('/accounts/detail', [{ label: '設定' }, { label: 'LINEアカウント', href: '/accounts' }], '店A'))
      .toEqual([{ label: '設定', href: '/settings' }, { label: 'LINEアカウント', href: '/accounts' }])
  })

  it('設定の入口・設定の外・統括には足さない', () => {
    expect(finishPageCrumbs('/settings', null, '機能設定')).toBeNull()
    expect(finishPageCrumbs('/nen-campaigns', null, 'NEN配信')).toBeNull()
    expect(finishPageCrumbs('/hq/settings', null, '統括の設定', true)).toBeNull()
  })
})
