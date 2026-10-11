'use client'

import type { NenColumn } from '@/lib/api'
import LinePreview, { LinePreviewFlex, LinePreviewMessage } from '@/components/shared/line-preview'

export const COLUMN_PET_NAME_FALLBACK = '大切なご家族'
export const replaceColumnSamples = (value: string) => value.replaceAll('{{pet_name}}', COLUMN_PET_NAME_FALLBACK)

export function replaceCampaignSamples(value: string): string {
  return Object.entries({ '{{pet_name}}': 'むぎちゃん', '{{coupon_code}}': 'NENBDAY-1234', '{{coupon_expiry}}': '2026-09-30' })
    .reduce((result, [from, to]) => result.replaceAll(from, to), value)
}

/** 旧一覧の紹介文→記事カードの見本を、共通のLINE表示へ引き継ぐ。送信はしない。 */
export default function ColumnPreview({ column, introText, buttonLabel }: { column: NenColumn; introText: string; buttonLabel: string }) {
  const content = JSON.stringify({
    type: 'bubble',
    ...(column.imageUrl ? { hero: { type: 'image', url: column.imageUrl, size: 'full', aspectRatio: '16:9', aspectMode: 'cover' } } : {}),
    body: { type: 'box', layout: 'vertical', contents: [
      ...(column.category ? [{ type: 'text', text: column.category, size: 'sm', wrap: true }] : []),
      { type: 'text', text: column.title, weight: 'bold', wrap: true },
      ...(column.excerpt ? [{ type: 'text', text: replaceColumnSamples(column.excerpt), wrap: true }] : []),
    ] },
    ...(buttonLabel ? { footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'uri', label: buttonLabel, uri: column.articleUrl } }] } } : {}),
  })
  return <LinePreview fit>
    {introText.trim() ? <LinePreviewMessage accountName="NEN" avatar={null} time="">{replaceColumnSamples(introText)}</LinePreviewMessage> : null}
    <LinePreviewFlex content={content} />
  </LinePreview>
}
