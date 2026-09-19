import type { NenCampaignSetting, NenColumn } from '@/lib/api'

/*
 * LINEに届く見え方。★V6 37-6-A（`u66A0`）「LINEに届くカード」。
 *
 * 実際の文面は Worker `services/nen-engagement.ts` の `flexMessage` /
 * `buildNenDeliveryMessages` が組み立てる。ここは同じ順番（紹介文 → カード）で
 * 見本を出すだけで、送る内容の正本ではない。
 */

/** 差し込みの見本。コラムの配信はペット情報を持たないため、実送信と同じ「大切なご家族」を出す。 */
export const COLUMN_PET_NAME_FALLBACK = '大切なご家族'

const CAMPAIGN_SAMPLES: Record<string, string> = {
  '{{pet_name}}': 'むぎちゃん',
  '{{coupon_code}}': 'NENBDAY-1234',
  '{{coupon_expiry}}': '2026-09-30',
}

export function replaceCampaignSamples(value: string): string {
  return Object.entries(CAMPAIGN_SAMPLES).reduce((result, [from, to]) => result.replaceAll(from, to), value)
}

export function replaceColumnSamples(value: string): string {
  return value.replaceAll('{{pet_name}}', COLUMN_PET_NAME_FALLBACK)
}

/** トークの背景と吹き出し。中身は呼び出し側が並べる。 */
export function LineTalk({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-card bg-line-preview p-4" data-design="LinePreview">
      {children}
    </div>
  )
}

export function LineTextBubble({ text }: { text: string }) {
  return <p className="max-w-xs self-start whitespace-pre-wrap rounded-card rounded-tl-sm bg-canvas px-3 py-2 text-caption leading-6 text-ink shadow-card">{text}</p>
}

/** 画像＋分類＋見出し＋抜粋＋ボタンのカード（Flex の bubble を模した見本）。 */
export function LineCard({
  imageUrl,
  category,
  title,
  body,
  buttonLabel,
}: {
  imageUrl: string | null
  category?: string | null
  title: string
  body: string
  buttonLabel: string | null
}) {
  return (
    <div className="w-full max-w-xs self-start overflow-hidden rounded-card bg-canvas shadow-card">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- ECのコラム画像をそのまま見本に出す
        <img src={imageUrl} alt="" className="aspect-video w-full object-cover" />
      ) : (
        <div aria-hidden="true" className="flex aspect-video w-full items-center justify-center bg-canvas-sunken text-micro text-ink-faint">画像なし</div>
      )}
      <div className="flex flex-col gap-2 p-3">
        {category ? <p className="text-micro font-semibold text-accent-deep">{category}</p> : null}
        <p className="text-label font-bold leading-6 text-ink">{title}</p>
        {body ? <p className="whitespace-pre-wrap text-caption leading-6 text-ink-secondary">{body}</p> : null}
        {buttonLabel ? <p className="mt-1 rounded-control bg-accent-deep py-2 text-center text-caption font-bold text-on-accent">{buttonLabel}</p> : null}
      </div>
    </div>
  )
}

/** 自動配信の1通の見え方。お客様ごとの値は見本に置き換える。 */
export function CampaignLinePreview({ setting }: { setting: NenCampaignSetting }) {
  return (
    <LineTalk>
      <LineCard
        imageUrl={setting.imageUrl}
        title={replaceCampaignSamples(setting.title)}
        body={replaceCampaignSamples(setting.bodyText)}
        buttonLabel={setting.buttonLabel}
      />
    </LineTalk>
  )
}

/** コラムの1通の見え方。紹介文の吹き出しのあとにカードが届く。 */
export function ColumnLinePreview({ column, introText, buttonLabel }: { column: NenColumn; introText: string; buttonLabel: string }) {
  return (
    <LineTalk>
      {introText.trim() ? <LineTextBubble text={replaceColumnSamples(introText)} /> : null}
      <LineCard
        imageUrl={column.imageUrl}
        category={column.category}
        title={column.title}
        body={replaceColumnSamples(column.excerpt)}
        buttonLabel={buttonLabel}
      />
    </LineTalk>
  )
}
