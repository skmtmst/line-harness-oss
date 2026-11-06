import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LinePreviewMessage } from './line-preview'
import { PREVIEW_SAMPLE, fillPreviewSample, previewSampleNote } from './preview-sample'

describe('下見の差し込みは見本の値で出す', () => {
  it('新しい形と古い形のどちらも記号を残さない', () => {
    const { text, kinds } = fillPreviewSample('{{name}}さん、{名前}さん 明日{予約日時}から。{{field.plan}}')
    expect(text).not.toMatch(/[{}]/)
    expect(text).toContain(`${PREVIEW_SAMPLE.name}さん`)
    expect(text).toContain(PREVIEW_SAMPLE.dateTime)
    expect(previewSampleNote(kinds)).toBe('名前と日時は見本です')
  })

  it('JSON の波かっこや差し込みの無い文は変えない', () => {
    expect(fillPreviewSample('{"type":"text"}')).toEqual({ text: '{"type":"text"}', kinds: [] })
    expect(previewSampleNote([])).toBeNull()
  })

  it('LINEの吹き出しは置き換えた値と「見本です」を出す', () => {
    const html = renderToStaticMarkup(<LinePreviewMessage accountName="然" avatar="然" time="9:00">{'{{name}}さん、こんにちは'}</LinePreviewMessage>)
    expect(html).toContain(`${PREVIEW_SAMPLE.name}さん`)
    expect(html).not.toContain('{{name}}')
    expect(html).toContain('名前は見本です')
    const plain = renderToStaticMarkup(<LinePreviewMessage accountName="然" avatar="然" time="9:00">こんにちは</LinePreviewMessage>)
    expect(plain).not.toContain('data-preview-sample-note')
  })
})
