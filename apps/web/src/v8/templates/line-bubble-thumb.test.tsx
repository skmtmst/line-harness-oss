// @vitest-environment happy-dom
/*
 * 一覧の小さな吹き出し：種類ごとの形・壊れた中身・差し込みの札・画像の読み込みを遅らせる。
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { TemplateQuestion } from '@/lib/api'
import LineBubbleThumb from './line-bubble-thumb'
import { bubbleThumbOf, type BubbleThumb } from './line-bubble-thumb-model'

afterEach(cleanup)

const question: TemplateQuestion = {
  text: 'ご来店の目的は？',
  tapMode: 'single',
  choices: [{ label: 'ランチ', behavior: 'none' }, { label: 'ディナー', behavior: 'none' }, { label: 'テイクアウト', behavior: 'none' }],
}

function of(messageType: string, content: string, q: TemplateQuestion | null = null): BubbleThumb {
  return bubbleThumbOf({ messageType, content, question: q })
}

function draw(thumb: BubbleThumb) {
  const { container } = render(<LineBubbleThumb thumb={thumb} />)
  return container.firstElementChild as HTMLElement
}

describe('bubbleThumbOf', () => {
  it('テキストは改行をつぶして1行にし、差し込みは文字のまま残す', () => {
    expect(of('text', '{{name}}さま\n明日のご予約です')).toEqual({ kind: 'text', text: '{{name}}さま 明日のご予約です' })
    expect(of('text', '   ')).toEqual({ kind: 'empty' })
  })

  it('長いテキストは途中で切れた差し込みを落とす', () => {
    const thumb = of('text', `${'あ'.repeat(115)}{{name}}`)
    expect(thumb).toEqual({ kind: 'text', text: 'あ'.repeat(115) })
  })

  it('画像は小さな絵（無ければ原寸）の https だけを使う', () => {
    expect(of('image', '{"originalContentUrl":"https://example.com/a.jpg","previewImageUrl":"https://example.com/s.jpg"}')).toEqual({ kind: 'image', src: 'https://example.com/s.jpg' })
    expect(of('image', '{"originalContentUrl":"https://example.com/a.jpg"}')).toEqual({ kind: 'image', src: 'https://example.com/a.jpg' })
    expect(of('image', '{"originalContentUrl":"javascript:alert(1)"}')).toEqual({ kind: 'unavailable' })
    expect(of('image', '{"originalContentUrl":"http://example.com/a.jpg"}')).toEqual({ kind: 'unavailable' })
  })

  it('カード型は描かずに題（altText）だけ、カルーセルは枚数を添える', () => {
    expect(of('flex', '{"type":"flex","altText":"秋の新メニュー","contents":{"type":"bubble"}}')).toEqual({ kind: 'card', title: '秋の新メニュー' })
    expect(of('carousel', '[{"title":"A"},{"title":"B"},{"title":"C"}]')).toEqual({ kind: 'carousel', title: 'A', count: 3 })
    expect(of('carousel', '{"columns":[{"text":"本文"}]}')).toEqual({ kind: 'carousel', title: '本文', count: 1 })
  })

  it('質問は問いの文と選択肢の数', () => {
    expect(of('flex', '{}', question)).toEqual({ kind: 'question', text: 'ご来店の目的は？', choices: 3 })
  })

  it('リッチメッセージとリッチビデオを分ける', () => {
    expect(of('imagemap', '{"altText":"春のキャンペーン","baseUrl":"https://example.com/r"}')).toEqual({ kind: 'rich_message', title: '春のキャンペーン' })
    expect(of('imagemap', '{"altText":"紹介動画","video":{"originalContentUrl":"https://example.com/v.mp4"}}')).toEqual({ kind: 'rich_video', title: '紹介動画' })
  })

  it('知らない種類・読めない JSON は「見え方を出せません」にする', () => {
    expect(of('sticker', '{"packageId":"1"}')).toEqual({ kind: 'unavailable' })
    expect(of('flex', '{"type":')).toEqual({ kind: 'unavailable' })
    expect(of('carousel', '[]')).toEqual({ kind: 'unavailable' })
    expect(of('imagemap', '[1]')).toEqual({ kind: 'unavailable' })
  })
})

describe('LineBubbleThumb', () => {
  it('飾りなので読み上げから外す', () => {
    const root = draw({ kind: 'text', text: 'こんにちは' })
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.textContent).toBe('こんにちは')
  })

  it('差し込みは見本の値にせず札で出す', () => {
    const root = draw(of('text', '{{name}}さま'))
    const chip = root.querySelector('[data-token="{{name}}"]')
    expect(chip?.textContent).toBe('名前')
    expect(root.textContent).not.toContain('山田')
  })

  it('画像は幅と高さを書き、読み込みを遅らせる', () => {
    const img = draw({ kind: 'image', src: 'https://example.com/s.jpg' }).querySelector('img')
    expect(img?.getAttribute('loading')).toBe('lazy')
    expect(img?.getAttribute('width')).toBe('48')
    expect(img?.getAttribute('height')).toBe('30')
    expect(img?.getAttribute('alt')).toBe('')
  })

  it('種類ごとの文と数', () => {
    expect(draw({ kind: 'carousel', title: '', count: 3 }).textContent).toBe('カルーセル3枚')
    expect(draw({ kind: 'question', text: '目的は？', choices: 2 }).textContent).toBe('目的は？選択肢 2')
    expect(draw({ kind: 'card', title: '' }).textContent).toBe('カード型')
    expect(draw({ kind: 'rich_video', title: '' }).textContent).toBe('リッチビデオ')
    const broken = draw({ kind: 'unavailable' })
    expect(broken.textContent).toBe('見え方を出せません')
    expect(broken.dataset.tone).toBe('muted')
  })
})
