import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import QrDialog from './qr-dialog'

/*
 * M (止めた流入経路の QR): 止めた経路は QR も印刷も出さない。
 *
 * - 選択肢には止めた経路を出さない
 * - URL指定で止めた経路を開いたら「停止しています」と理由・時刻を出し、
 *   QR画像・ダウンロード・印刷を止める
 * - 受付中は QR と「PDFで印刷」を出す
 */
vi.mock('@/components/shared/select', () => ({
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

const stoppedRoute = {
  id: 'er-stopped',
  refCode: 'flyer-spring',
  genre: '紙',
  name: 'チラシ（2026春）',
  tagId: null,
  scenarioId: null,
  redirectUrl: null,
  poolId: null,
  introTemplateId: null,
  runAccountFriendAddScenarios: true,
  isActive: false,
  stoppedAt: '2026-06-30T00:00:00.000Z',
  stoppedReason: '春の配布が終わった',
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-06-30T00:00:00.000Z',
}

const activeRoute = {
  ...stoppedRoute,
  id: 'er-active',
  refCode: 'summer-ig',
  name: '夏のInstagram投稿',
  isActive: true,
  stoppedAt: null,
  stoppedReason: null,
}

function markup(props: Partial<React.ComponentProps<typeof QrDialog>>): string {
  return renderToStaticMarkup(
    <QrDialog
      open
      onClose={() => {}}
      accountName="然-NEN- 公式"
      officialProfileUrl="https://lin.ee/example"
      accountBasicId="@nen"
      baseLink="https://line.me/R/ti/p/@nen"
      routes={[activeRoute, stoppedRoute] as never}
      {...props}
    />,
  )
}

describe('止めた経路のQR（M）', () => {
  it('選択肢には受付中だけを出す', () => {
    const html = markup({})
    expect(html).toContain('夏のInstagram投稿')
    expect(html).not.toContain('チラシ（2026春）')
  })

  it('止めた経路は停止文と理由を出し、QR・保存・印刷を止める', () => {
    const html = markup({ initialRouteId: 'er-stopped' })
    expect(html).toContain('この経路は停止しています')
    expect(html).toContain('春の配布が終わった')
    expect(html).not.toContain('alt="友だち追加QRコード"')
    // ダウンロードと印刷は押せない。
    const disabledButtons = [...html.matchAll(/<button[^>]*disabled[^>]*>([\s\S]*?)<\/button>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
    expect(disabledButtons).toContain('画像をダウンロード')
    expect(disabledButtons).toContain('PDFで印刷')
  })

  it('受付中はQRとPDFで印刷を出す', () => {
    const html = markup({ initialRouteId: 'er-active' })
    expect(html).toContain('alt="友だち追加QRコード"')
    expect(html).toContain('PDFで印刷')
    expect(html).not.toContain('この経路は停止しています')
  })

  it('見つからない経路は選び直しを出す', () => {
    const html = markup({ initialRouteId: 'er-missing', routes: [activeRoute] as never })
    expect(html).toContain('見つかりません')
    expect(html).not.toContain('alt="友だち追加QRコード"')
  })
})
