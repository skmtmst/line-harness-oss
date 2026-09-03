import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

/** 注釈を落とす。「なぜ消したか」を書いた文が、消したはずの字面に当たるのを避ける。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const CODE = code(PAGE)

/**
 * 検証環境で、見出しの下に `ec_order.confirmed` が出ていた。
 * `{setting.eventType}` をそのまま描き、全文を `title` にも入れていた。
 *
 * V6の「内部IDを画面に出さない」に反する。区分の言葉は上の絞り込みが
 * 既に持っているので、それを使う。
 */
describe('LINE通知の見出しは、内部のイベントキーを出さない', () => {
  it('eventType を本文にも title にも描かない', () => {
    expect(CODE, 'eventType を本文に出している').not.toContain('>{setting.eventType}<')
    expect(CODE, 'eventType を title に入れている').not.toContain('title={setting.eventType}')
  })

  it('区分の言葉に置き換えている', () => {
    expect(CODE).toContain('{categoryLabel(setting.category)}')
    expect(CODE).toContain("categories.find(([key]) => key === value)?.[1] ?? '区分なし'")
  })

  it('最終更新は日本時間で、取れないときは数を作らない', () => {
    expect(CODE).toContain("timeZone: 'Asia/Tokyo'")
    expect(CODE).toContain("return '最終更新 —'")
  })

  it('eventType 自体は鍵や絞り込みに使ってよい（描かないだけ）', () => {
    expect(CODE, '鍵として使うのはよい').toContain('key={setting.eventType}')
  })
})
