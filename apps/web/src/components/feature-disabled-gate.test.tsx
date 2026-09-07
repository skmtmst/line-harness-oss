import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FeatureDisabledScreen } from './feature-disabled-gate'

describe('機能オフの共通案内画面', () => {
  it('理由と復旧先をPencilの共通エラー構造で示す', () => {
    const html = renderToStaticMarkup(<FeatureDisabledScreen featureId="webinars" />)

    expect(html).toContain('data-list-state="forbidden"')
    expect(html).toContain('この機能は設定でオフになっています')
    expect(html).toContain('機能設定で有効にすると使えます。')
    expect(html).toContain('href="/settings"')
    expect(html).toContain('機能設定を開く')
    expect(html).toContain('data-feature-disabled="webinars"')
  })
})
