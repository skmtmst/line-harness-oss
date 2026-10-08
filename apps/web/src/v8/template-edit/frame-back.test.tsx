// @vitest-environment happy-dom
/*
 * 「← テンプレートへ」：統括のひな形の作る画面は一覧と同じ URL のまま段を替えるので、
 * onBack を渡されたらリンクでなくボタンで戻る（同じ URL へのリンクでは何も起きなかった・オーナー 10-08）。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateEditFrame } from './frame'

afterEach(cleanup)

describe('TemplateEditFrame の戻る', () => {
  it('onBack があればボタンで、押すと onBack を呼ぶ', () => {
    const onBack = vi.fn()
    render(<TemplateEditFrame boardId="J60utH" title="カルーセルを作る" description="" side={null} backHref="/hq/templates" onBack={onBack}><p>中身</p></TemplateEditFrame>)
    expect(screen.queryByRole('link', { name: '← テンプレートへ' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '← テンプレートへ' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
  it('onBack が無ければ今までどおり店のテンプレートへのリンク', () => {
    render(<TemplateEditFrame boardId="J60utH" title="カルーセルを作る" description="" side={null}><p>中身</p></TemplateEditFrame>)
    expect(screen.getByRole('link', { name: '← テンプレートへ' }).getAttribute('href')).toBe('/templates')
  })
})
