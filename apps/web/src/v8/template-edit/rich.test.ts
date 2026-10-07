import { describe, expect, test } from 'vitest'
import { RICH_SHAPES, areaPlace, buildRichPayload, emptyAreaDraft } from './rich'

/*
 * ★V8 リッチメッセージを作る（EFV8l）の保存値と面の呼び名。
 * 保存値は今の画面（template-asset-editor.tsx）と同じ形：選んだ形の面だけを座標と動きつきで送る。
 */
const shape = (value: string) => RICH_SHAPES.find((s) => s.value === value)!

describe('面の呼び名', () => {
  test('形ごとに「上・下」「左・右」「左上…」で呼ぶ', () => {
    const names = (value: string) => shape(value).areas.map((a) => `${a.label} ${areaPlace(a, shape(value).areas)}`)
    expect(names('1')).toEqual(['A 全体'])
    expect(names('2v')).toEqual(['A 上', 'B 下'])
    expect(names('2h')).toEqual(['A 左', 'B 右'])
    expect(names('3')).toEqual(['A 上', 'B 左下', 'C 右下'])
    expect(names('4')).toEqual(['A 左上', 'B 右上', 'C 左下', 'D 右下'])
    expect(names('6')).toEqual(['A 左上', 'B 中上', 'C 右上', 'D 左下', 'E 中下', 'F 右下'])
  })
})

describe('保存値', () => {
  test('画像が無ければ送らない・URL を選んで空なら送らない', () => {
    expect(buildRichPayload({ imageUrl: ' ', pickedMedia: null, shape: shape('2v'), areas: {} })).toEqual({ error: '画像を設定してください。' })
    expect(buildRichPayload({ imageUrl: 'https://x.example/a.png', pickedMedia: null, shape: shape('2v'), areas: { B: { ...emptyAreaDraft(), kind: 'uri' } } }))
      .toEqual({ error: '面 B のURLを入力してください。' })
  })

  test('選んだ形の面だけを、座標と動きつきで送る', () => {
    const built = buildRichPayload({
      imageUrl: ' https://x.example/a.png ',
      pickedMedia: null,
      shape: shape('2v'),
      areas: { A: { kind: 'uri', uri: ' https://nen.example/summer ', actions: [] }, C: { kind: 'uri', uri: 'https://other', actions: [] } },
    })
    expect('payload' in built).toBe(true)
    if (!('payload' in built)) return
    expect(built.payload.imageUrl).toBe('https://x.example/a.png')
    expect(built.payload.shape).toBe('2v')
    expect(built.payload.tapAreas).toEqual([
      { label: 'A', x: 0, y: 0, width: 100, height: 50, actionType: 'uri', uri: 'https://nen.example/summer' },
      { label: 'B', x: 0, y: 50, width: 100, height: 50, actionType: 'none' },
    ])
  })
})
