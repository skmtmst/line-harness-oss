/*
 * 位置情報・動画・音声・スタンプの入力と保存の形。
 *
 * 画面が作る JSON と、worker の buildMessage が読む形が**同じ**であること。
 * ここがずれると、保存はできるのに配信でテキストに落ちる（相手には
 * `{"latitude":35.6,...}` という生の文字列が届く）。
 *
 * 往復（書く → 保存 → 編集で開き直す）も見る。開き直したときに欄が
 * 空だと、書き直しになる。
 */
import { describe, it, expect } from 'vitest'
import {
  emptyMessageKindState,
  serializeMessageKind,
  parseMessageKind,
  type MessageKindState,
} from './message-kind-fields'

function withLocation(patch: Partial<MessageKindState['location']>): MessageKindState {
  const s = emptyMessageKindState()
  s.location = { ...s.location, ...patch }
  return s
}

describe('位置情報', () => {
  it('緯度経度を数として書き出す（文字列のままだと配信側が弾く）', () => {
    const json = serializeMessageKind(
      'location',
      withLocation({ title: '本店', address: '東京都', latitude: '35.658', longitude: '139.701' }),
    )
    expect(JSON.parse(json!)).toEqual({
      title: '本店',
      address: '東京都',
      latitude: 35.658,
      longitude: 139.701,
    })
  })

  it('見出しが空なら既定を入れる（LINEが必須にしている）', () => {
    const json = serializeMessageKind('location', withLocation({ latitude: '35', longitude: '139' }))
    expect(JSON.parse(json!).title).toBe('場所')
  })

  it('緯度経度が空なら書き出さない', () => {
    expect(serializeMessageKind('location', withLocation({ title: '本店' }))).toBeNull()
    expect(serializeMessageKind('location', withLocation({ latitude: '35' }))).toBeNull()
  })

  it('数でない値は書き出さない', () => {
    expect(
      serializeMessageKind('location', withLocation({ latitude: 'あ', longitude: '139' })),
    ).toBeNull()
  })

  it('書いた値が編集で戻る', () => {
    const before = withLocation({ title: '本店', address: '東京都', latitude: '35.658', longitude: '139.701' })
    const json = serializeMessageKind('location', before)!
    expect(parseMessageKind('location', json).location).toEqual(before.location)
  })
})

describe('動画', () => {
  it('本体とサムネイルの両方が要る', () => {
    const s = emptyMessageKindState()
    s.video = { originalContentUrl: 'https://e.com/v.mp4', previewImageUrl: '' }
    expect(serializeMessageKind('video', s)).toBeNull()
    s.video.previewImageUrl = 'https://e.com/p.jpg'
    expect(JSON.parse(serializeMessageKind('video', s)!)).toEqual({
      originalContentUrl: 'https://e.com/v.mp4',
      previewImageUrl: 'https://e.com/p.jpg',
    })
  })

  it('前後の空白を落とす', () => {
    const s = emptyMessageKindState()
    s.video = { originalContentUrl: '  https://e.com/v.mp4 ', previewImageUrl: ' https://e.com/p.jpg ' }
    expect(JSON.parse(serializeMessageKind('video', s)!).originalContentUrl).toBe('https://e.com/v.mp4')
  })
})

describe('音声', () => {
  it('画面は秒、保存はミリ秒', () => {
    const s = emptyMessageKindState()
    s.audio = { originalContentUrl: 'https://e.com/a.m4a', duration: '30' }
    expect(JSON.parse(serializeMessageKind('audio', s)!).duration).toBe(30000)
  })

  it('小数の秒も丸めて保存する', () => {
    const s = emptyMessageKindState()
    s.audio = { originalContentUrl: 'https://e.com/a.m4a', duration: '12.5' }
    expect(JSON.parse(serializeMessageKind('audio', s)!).duration).toBe(12500)
  })

  it('長さが0以下なら書き出さない', () => {
    const s = emptyMessageKindState()
    for (const duration of ['0', '-3', '']) {
      s.audio = { originalContentUrl: 'https://e.com/a.m4a', duration }
      expect(serializeMessageKind('audio', s)).toBeNull()
    }
  })

  it('編集で開くと秒に戻る', () => {
    const s = emptyMessageKindState()
    s.audio = { originalContentUrl: 'https://e.com/a.m4a', duration: '30' }
    const json = serializeMessageKind('audio', s)!
    expect(parseMessageKind('audio', json).audio.duration).toBe('30')
  })
})

describe('スタンプ', () => {
  it('2つの番号がそろって初めて書き出す', () => {
    const s = emptyMessageKindState()
    s.sticker = { packageId: '446', stickerId: '' }
    expect(serializeMessageKind('sticker', s)).toBeNull()
    s.sticker.stickerId = '1988'
    expect(JSON.parse(serializeMessageKind('sticker', s)!)).toEqual({
      packageId: '446',
      stickerId: '1988',
    })
  })

  it('編集で戻る', () => {
    const s = emptyMessageKindState()
    s.sticker = { packageId: '789', stickerId: '10855' }
    const json = serializeMessageKind('sticker', s)!
    expect(parseMessageKind('sticker', json).sticker).toEqual(s.sticker)
  })
})

describe('読めない値', () => {
  it('壊れたJSONは空欄にする（壊れたまま保存し直させない）', () => {
    expect(parseMessageKind('location', '{こわれ').location).toEqual(
      emptyMessageKindState().location,
    )
  })

  it('中身が無い場合も空欄', () => {
    expect(parseMessageKind('sticker', null).sticker).toEqual(emptyMessageKindState().sticker)
    expect(parseMessageKind('sticker', '').sticker).toEqual(emptyMessageKindState().sticker)
  })

  it('配列を渡されても落ちない', () => {
    expect(parseMessageKind('video', '[1,2]').video).toEqual(emptyMessageKindState().video)
  })
})
