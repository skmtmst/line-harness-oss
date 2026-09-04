'use client'

import { useEffect, useState } from 'react'
import type { EntryRoute } from '@line-crm/shared'
import { api } from '@/lib/api'
import SelectField from '@/components/shared/select-field'

/**
 * 友だち追加のQRコード（設計 V2 1-1-1）。
 *
 * ダッシュボードの「QRを表示」から開く。設計どおり、印刷に使う大きさを
 * 選べるようにしてある。Worker の /api/qr は size と download を受けるので、
 * 保存もそのまま通る。
 *
 * PDF生成APIは無いため、ブラウザの印刷画面を開く。そこで「PDFに保存」を
 * 選べば、外部サービスへデータを送らずにPDF化できる。
 */

const SIZES = [
  { value: '1200x1200', label: '大（1200px）', note: '印刷向け' },
  { value: '600x600', label: '中（600px）', note: '画面向け' },
  { value: '300x300', label: '小（300px）', note: '確認用' },
]

/** Worker の /api/qr が受ける形式。順番はよく使うものから。 */
const FORMATS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
  { value: 'svg', label: 'SVG' },
]

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 3v9m0 0 3-3m-3 3L7 9M4 14v2h12v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function QrDialog({
  open,
  onClose,
  accountName,
  accountBasicId,
  baseLink,
  initialRouteId = '',
}: {
  open: boolean
  onClose: () => void
  accountName: string
  /** 公式アカウントのID（`@nen` など）。QRの下に出す案内先の組み立てに使う。 */
  accountBasicId?: string | null
  baseLink: string
  /** 呼び出し元で選んでいた経路。開いたときの初期値になる。 */
  initialRouteId?: string
}) {
  const [routes, setRoutes] = useState<EntryRoute[]>([])
  const [routeId, setRouteId] = useState(initialRouteId)
  const [size, setSize] = useState(SIZES[0].value)
  const [format, setFormat] = useState(FORMATS[0].value)
  const [copied, setCopied] = useState(false)

  // 開くたびに呼び出し元の選択に合わせる。閉じている間に向こうで
  // 経路を変えていたら、次に開いたときはそちらが正。
  useEffect(() => {
    if (open) setRouteId(initialRouteId)
  }, [open, initialRouteId])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void api.entryRoutes.list()
      .then((res) => {
        // 停止中の経路のQRを配ると、読み取っても友だち追加できない。
        if (!cancelled && res.success) setRoutes(res.data.filter((r) => r.isActive))
      })
      .catch(() => {
        // 経路一覧だけが取れなくても、基本の追加URLのQRは表示できる。
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')
  const route = routes.find((r) => r.id === routeId)
  const link = route ? `${base}/r/${route.refCode}` : baseLink
  const qrSrc = `${base}/api/qr?size=${size}&format=${format}&data=${encodeURIComponent(link)}`
  const saveHref = `${qrSrc}&download=1&filename=${encodeURIComponent(
    route ? `qr-${route.refCode}` : 'qr-friend-add',
  )}`

  /*
   * QRの下に出す案内先。
   *
   * 経路を選んでいればその経路のリンク。経路ごとに分けて発行したのに
   * ここが公式アカウントのままだと、どのQRを見ているのか分からない。
   *
   * 基本のときは公式アカウントのURL。LINE が配る lin.ee の短縮URLは
   * API から取れないので、公式ID（basicId）から組み立てる。同じ場所に
   * 着く。ID が無いアカウントでは何も出さない。
   */
  const profileUrl = route
    ? link
    : accountBasicId
      ? `https://line.me/R/ti/p/${accountBasicId.startsWith('@') ? accountBasicId : `@${accountBasicId}`}`
      : null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // 安全なコンテキストでないとコピーできない。下の欄から手で取れる。
    }
  }

  const printQr = () => {
    const printWindow = window.open('', '_blank', 'width=720,height=820')
    if (!printWindow) return
    printWindow.opener = null
    const doc = printWindow.document
    doc.title = `${accountName} 友だち追加QRコード`
    const style = doc.createElement('style')
    style.textContent = 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:48px;text-align:center;color:#1a1c1a}main{max-width:560px;margin:0 auto}img{width:360px;height:360px;object-fit:contain}h1{font-size:22px;margin:24px 0 8px}p{font-size:12px;color:#565f59;word-break:break-all}@media print{body{padding:20mm}}'
    doc.head.appendChild(style)
    const main = doc.createElement('main')
    const image = doc.createElement('img')
    image.alt = '友だち追加QRコード'
    image.src = qrSrc
    const heading = doc.createElement('h1')
    heading.textContent = accountName
    const url = doc.createElement('p')
    url.textContent = link
    main.append(image, heading, url)
    doc.body.appendChild(main)
    image.onload = () => {
      printWindow.focus()
      printWindow.print()
    }
  }

  return (
    <div
      data-design="QR"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="友だち追加のQRコード"
      onClick={onClose}
    >
      <div
        className="bg-canvas rounded-panel border-hairline max-h-[90vh] w-full max-w-[820px] overflow-y-auto border p-6 shadow-[1px_1px_2px_rgba(29,29,31,0.13)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-ink text-base font-bold">友だち追加のQRコード</h2>
            <p className="text-ink-faint mt-1 text-xs leading-relaxed">
              チラシ・店頭POP・名刺などに印刷して使えます。読み取ると友だち追加の画面が開きます。
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="text-ink-faint hover:text-ink shrink-0 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
          {/* 名前はQRの下。読み取る人が見るのは絵で、名前はその確認に使う。 */}
          <div className="flex flex-col items-center">
            <div className="bg-canvas-sunken rounded-panel flex h-[280px] w-[280px] items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- Worker のQRプロキシ。静的アセットではない */}
              <img
                src={qrSrc}
                alt="友だち追加QRコード"
                width={220}
                height={220}
                className="h-[220px] w-[220px]"
              />
            </div>
            <p className="text-ink mt-3 text-sm font-medium">{accountName}</p>
            {profileUrl && (
              <a
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-action mt-1 max-w-[280px] truncate text-xs hover:underline"
              >
                {profileUrl}
              </a>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="qr-route" className="text-ink-secondary mb-1 block text-xs font-medium">
                発行中の追加URL
              </label>
              <SelectField
                id="qr-route"
                value={routeId}
                onChange={(e) => setRouteId(e.target.value)}
                className="w-full"
                options={[
                  { value: '', label: '基本の追加URL' },
                  ...routes.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
              <p className="text-ink-faint mt-1 text-xs">
                選んだ経路のQRコードとURLが表示されます。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label htmlFor="qr-size" className="text-ink-secondary mb-1 block text-xs font-medium">
                  画像の大きさ
                </label>
                <SelectField
                  id="qr-size"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="w-full"
                  options={SIZES.map((s) => ({ value: s.value, label: s.label }))}
                />
              </div>
              <div>
                <span className="text-ink-secondary mb-1 block text-xs font-medium">
                  ダウンロード形式
                </span>
                <div className="border-hairline rounded-control flex overflow-hidden border" aria-label="画像形式">
                  {FORMATS.map((entry) => (
                    <button
                      key={entry.value}
                      type="button"
                      onClick={() => setFormat(entry.value)}
                      aria-pressed={format === entry.value}
                      className={`border-hairline border-r px-3 py-2 text-xs font-medium last:border-r-0 ${format === entry.value ? 'bg-action text-on-action' : 'text-ink-secondary hover:bg-canvas-sunken'}`}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label
                htmlFor="qr-link"
                className="text-ink-secondary mb-1 block text-xs font-medium"
              >
                友だち追加リンク
              </label>
              <div className="border-hairline bg-canvas-sunken rounded-control relative flex items-stretch border">
                <textarea
                  id="qr-link"
                  readOnly
                  rows={2}
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="text-ink-secondary min-w-0 flex-1 resize-none bg-transparent px-3 py-2 pr-16 font-mono text-xs leading-relaxed focus:outline-none"
                />
                <button
                  onClick={copy}
                  className="text-action absolute right-2 top-2 rounded px-1.5 py-1 text-xs font-medium hover:underline"
                >
                  {copied ? 'コピーしました ✓' : 'コピー'}
                </button>
              </div>
              <p className="text-ink-faint mt-1 text-xs">
                このURLから追加された友だちは、流入元を記録して計測できます。
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href={saveHref}
                className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control inline-flex items-center gap-2 px-4 py-2 text-sm font-medium"
              >
                <DownloadIcon />画像をダウンロード
              </a>
              <button
                type="button"
                onClick={printQr}
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
              >
                PDFで印刷
              </button>
            </div>
          </div>
        </div>

        <div className="border-hairline bg-surface-pearl mt-5 rounded-control border p-4">
          <h3 className="text-ink text-sm font-bold">使うときのヒント</h3>
          <ul className="text-ink-faint mt-2 space-y-1 text-xs leading-relaxed">
            <li>・印刷は 1200px 以上を推奨します（小さいと読み取れないことがあります）</li>
            <li>・流入経路ごとにリンクを分けると、どこから来たかを計測できます</li>
            <li>・QRの周囲は余白を1cm以上あけてください</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
