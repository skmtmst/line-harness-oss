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

  it('区分の言葉は運用者の言葉の一覧から取る', () => {
    // 板 g3iDs：行の補足は出来事の言葉（いつ・だれに）だけ。区分の列は置かない。
    expect(CODE).toContain('deliveryWords(setting).trigger')
    expect(CODE).toContain('audienceLabel(setting)')
  })

  it('eventType 自体は鍵や絞り込みに使ってよい（描かないだけ）', () => {
    expect(CODE, '鍵として使うのはよい').toContain('key={setting.eventType}')
  })
})
