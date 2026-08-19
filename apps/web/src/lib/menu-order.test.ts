/*
 * 左メニューの並び順。
 *
 * 保存された並びに載っていない項目の置き場所が問題になる。以前は末尾に
 * まとめていたので、**これから足すメニューが全部いちばん下に落ちた**。
 * 並び順を一度でも保存したことがある人には、新しい機能が毎回下に現れる。
 * 現れた場所が「その他」の下だったりすると、気づかない人が出る。
 *
 * 実際、「共通情報」を足したときに「登録メディア一覧」の下に回った。
 */
import { describe, it, expect } from 'vitest'
import { applyItemOrder } from './menu'
import type { MenuSection } from './menu'

/** 定義の並び。a → b → c → d。 */
function section(): MenuSection {
  return {
    id: 's',
    label: 'テスト',
    items: (['a', 'b', 'c', 'd'] as const).map((id) => ({
      href: `/${id}`,
      label: id.toUpperCase(),
      icon: '',
      id,
    })),
  } as MenuSection
}

const ids = (s: MenuSection) => s.items.map((i) => i.id)

describe('保存された並びを当てる', () => {
  it('保存が無ければ定義のまま', () => {
    expect(ids(applyItemOrder(section(), undefined))).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(applyItemOrder(section(), []))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('保存された並びのとおりにする', () => {
    expect(ids(applyItemOrder(section(), ['d', 'c', 'b', 'a']))).toEqual(['d', 'c', 'b', 'a'])
  })

  it('保存に無い項目は、定義で前にいた項目のうしろへ入る', () => {
    // c は保存に無い。定義では b のうしろなので、b のうしろに入る。
    // 末尾に送ると、新しく足したメニューがいつも一番下に落ちる。
    expect(ids(applyItemOrder(section(), ['d', 'b', 'a']))).toEqual(['d', 'b', 'c', 'a'])
  })

  it('保存に無い項目が定義の先頭なら、先頭へ入る', () => {
    expect(ids(applyItemOrder(section(), ['d', 'c', 'b']))).toEqual(['a', 'd', 'c', 'b'])
  })

  it('保存に無い項目が続いていても、定義の並びを保つ', () => {
    // b と c が保存に無い。定義どおり b → c の順で、a のうしろへ。
    expect(ids(applyItemOrder(section(), ['d', 'a']))).toEqual(['d', 'a', 'b', 'c'])
  })

  it('保存された並びは動かさない', () => {
    // わざわざ並べ替えた人の意図を壊さない。新しい項目を差し込むだけ。
    const out = ids(applyItemOrder(section(), ['d', 'b', 'a']))
    expect(out.filter((id) => ['d', 'b', 'a'].includes(id))).toEqual(['d', 'b', 'a'])
  })

  it('消えた項目が保存に残っていても落ちない', () => {
    expect(ids(applyItemOrder(section(), ['x', 'd', 'a']))).toEqual(['d', 'a', 'b', 'c'])
  })

  it('保存が全部知らない項目なら、定義のまま', () => {
    expect(ids(applyItemOrder(section(), ['x', 'y']))).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('実際に起きたこと', () => {
  it('「共通情報」を足したとき、「登録メディア一覧」の上に出る', () => {
    // 定義は 共通情報 → 登録メディア一覧。保存には登録メディア一覧しかない。
    const contents = {
      id: 'contents',
      label: 'コンテンツ',
      items: [
        { href: '/templates', label: 'テンプレート', icon: '', id: 'templates' },
        { href: '/contents/vars', label: '共通情報', icon: '', id: 'common-vars' },
        { href: '/contents', label: '登録メディア一覧', icon: '', id: 'contents' },
      ],
    } as MenuSection
    expect(ids(applyItemOrder(contents, ['templates', 'contents'])))
      .toEqual(['templates', 'common-vars', 'contents'])
  })
})
