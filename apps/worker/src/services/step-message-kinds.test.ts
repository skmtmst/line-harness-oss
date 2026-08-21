/*
 * 増やしたメッセージ種別（位置情報・動画・音声・スタンプ）の組み立て。
 *
 * 中身が足りないときに **テキストへ落とす** のが要点。例外にすると、
 * 1通の設定が壊れているだけで、その人の以降の配信まで止まる。
 * 既存の image / flex と同じ扱いにそろえてある。
 */
import { describe, it, expect } from 'vitest'
import { buildMessage } from './step-delivery.js'

describe('位置情報', () => {
  it('緯度経度がそろっていれば location として組み立てる', () => {
    const out = buildMessage(
      'location',
      JSON.stringify({ title: '然-NEN- 本店', address: '東京都渋谷区1-2-3', latitude: 35.6, longitude: 139.7 }),
    )
    expect(out).toEqual({
      type: 'location',
      title: '然-NEN- 本店',
      address: '東京都渋谷区1-2-3',
      latitude: 35.6,
      longitude: 139.7,
    })
  })

  it('見出しが空でも送れる（LINEが必須にしているので既定を入れる）', () => {
    const out = buildMessage('location', JSON.stringify({ latitude: 35.6, longitude: 139.7 }))
    expect(out).toMatchObject({ type: 'location', title: '場所', address: '' })
  })

  it('緯度経度が数でなければテキストに落とす', () => {
    const raw = JSON.stringify({ title: 'x', latitude: '35.6', longitude: '139.7' })
    expect(buildMessage('location', raw)).toEqual({ type: 'text', text: raw })
  })

  it('壊れたJSONでもテキストに落ちる（例外にしない）', () => {
    expect(buildMessage('location', '{こわれ')).toEqual({ type: 'text', text: '{こわれ' })
  })
})

describe('動画', () => {
  it('本体とサムネイルがそろっていれば video', () => {
    const out = buildMessage(
      'video',
      JSON.stringify({ originalContentUrl: 'https://e.com/v.mp4', previewImageUrl: 'https://e.com/p.jpg' }),
    )
    expect(out).toEqual({
      type: 'video',
      originalContentUrl: 'https://e.com/v.mp4',
      previewImageUrl: 'https://e.com/p.jpg',
    })
  })

  it('サムネイルが無ければテキストに落とす（LINEが必須にしている）', () => {
    const raw = JSON.stringify({ originalContentUrl: 'https://e.com/v.mp4' })
    expect(buildMessage('video', raw)).toEqual({ type: 'text', text: raw })
  })
})

describe('音声', () => {
  it('長さがあれば audio', () => {
    const out = buildMessage(
      'audio',
      JSON.stringify({ originalContentUrl: 'https://e.com/a.m4a', duration: 12000 }),
    )
    expect(out).toEqual({ type: 'audio', originalContentUrl: 'https://e.com/a.m4a', duration: 12000 })
  })

  it('長さが0や未設定ならテキストに落とす', () => {
    for (const duration of [0, -1, undefined]) {
      const raw = JSON.stringify({ originalContentUrl: 'https://e.com/a.m4a', duration })
      expect(buildMessage('audio', raw)).toEqual({ type: 'text', text: raw })
    }
  })
})

describe('スタンプ', () => {
  it('2つの番号がそろっていれば sticker', () => {
    const out = buildMessage('sticker', JSON.stringify({ packageId: '446', stickerId: '1988' }))
    expect(out).toEqual({ type: 'sticker', packageId: '446', stickerId: '1988' })
  })

  it('番号が数で入っていても文字列にそろえる（LINEは文字列で受ける）', () => {
    const out = buildMessage('sticker', JSON.stringify({ packageId: 446, stickerId: 1988 }))
    expect(out).toEqual({ type: 'sticker', packageId: '446', stickerId: '1988' })
  })

  it('片方だけならテキストに落とす', () => {
    const raw = JSON.stringify({ packageId: '446' })
    expect(buildMessage('sticker', raw)).toEqual({ type: 'text', text: raw })
  })
})

describe('これまでの種別を壊していない', () => {
  it('テキスト', () => {
    expect(buildMessage('text', 'こんにちは')).toEqual({ type: 'text', text: 'こんにちは' })
  })

  it('画像', () => {
    const out = buildMessage(
      'image',
      JSON.stringify({ originalContentUrl: 'https://e.com/i.jpg', previewImageUrl: 'https://e.com/t.jpg' }),
    )
    expect(out).toMatchObject({ type: 'image' })
  })

  it('知らない種別はテキストに落とす', () => {
    expect(buildMessage('imagemap', 'なにか')).toEqual({ type: 'text', text: 'なにか' })
  })
})
