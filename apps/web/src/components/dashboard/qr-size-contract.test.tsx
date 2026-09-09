import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { normalizeQrFormat, normalizeQrSize } from '../../../../worker/src/lib/qr-response'
import QrDialog from './qr-dialog'

/*
 * 画面が出す大きさ・形式が、実際の Worker /api/qr の受け口を通るかを、
 * 文字合わせではなく Worker 本体の関数（`normalizeQrSize` / `normalizeQrFormat`）で確かめる。
 * 画面側だけで同じ数字を書き写すと、Worker が上限を変えたときに気づけない。
 *
 * `SelectField` は共通部品で、この試験の対象ではない。共通部品側は React を
 * import していないため旧JSX変換のこの環境では描けない。選択肢の値は画面から
 * 渡ってくるので、素の `select` へ置き換えても確かめたいことは変わらない。
 */
vi.mock('@/components/shared/select-field', () => ({
  default: ({ id, value, options }: {
    id?: string
    value?: string
    options: { value: string; label: string }[]
  }) => (
    <select id={id} defaultValue={value}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}))

const MARKUP = renderToStaticMarkup(
  <QrDialog
    open
    onClose={() => {}}
    accountName="然-NEN- 公式"
    officialProfileUrl="https://lin.ee/example"
    accountBasicId="@nen"
    baseLink="https://line.me/R/ti/p/@nen"
    routes={[]}
  />,
)

/** 「画像をダウンロード」のリンク先。実際に押したときに飛ぶURLそのもの。 */
function downloadHref(): string {
  const match = /<a class="[^"]*" href="([^"]*\/api\/qr[^"]*)"/.exec(MARKUP)
  expect(match, 'ダウンロードのリンクが見つからない').not.toBeNull()
  return match![1].replace(/&amp;/g, '&')
}

describe('QRの大きさと形式（#689）', () => {
  it('選べる大きさが全て /api/qr の契約を通る', () => {
    const values = [...MARKUP.matchAll(/<option value="(\d{2,4}x\d{2,4})"/g)].map((m) => m[1])
    expect(values, '大きさの選択肢が読めていない').toEqual(['1024x1024', '600x600', '300x300'])
    for (const value of values) {
      expect(normalizeQrSize(value), `${value} は /api/qr が 400 にする`).toBe(value)
    }
  })

  it('選べる形式が全て /api/qr の契約を通る', () => {
    const labels = [...MARKUP.matchAll(/<button type="button" aria-pressed="(?:true|false)"[^>]*>([A-Z]+)<\/button>/g)]
      .map((m) => m[1].toLowerCase())
    expect(labels, '形式の選択肢が読めていない').toEqual(['png', 'jpg', 'svg'])
    for (const label of labels) {
      // 知らない値は png へ丸められる。丸められた＝画面の表示と違うものが届く。
      expect(normalizeQrFormat(label), `${label} は png へ丸められる`).toBe(label)
    }
  })

  it('既定のダウンロード先が1024pxで、保存名まで載っている', () => {
    const href = downloadHref()
    const params = new URL(href).searchParams
    expect(params.get('size')).toBe('1024x1024')
    expect(normalizeQrSize(params.get('size') ?? undefined)).toBe('1024x1024')
    expect(params.get('format')).toBe('png')
    expect(params.get('download')).toBe('1')
    expect(params.get('filename')).toBe('qr-friend-add')
    expect(params.get('data')).toBe('https://line.me/R/ti/p/@nen')
  })

  it('1200pxはWorkerが受けないので画面にも残さない（直した理由そのもの）', () => {
    expect(normalizeQrSize('1200x1200'), 'Workerが1200を受けるなら直す理由が変わる').toBeNull()
    expect(MARKUP).not.toContain('1200x1200')
    expect(MARKUP, '案内文に届かない大きさが残っている').not.toContain('1200px')
  })
})
