'use client'

import { useEffect, useState } from 'react'
import type { EntryRoute } from '@line-crm/shared'
import { api } from '@/lib/api'

/**
 * 友だち追加のQRコード（設計 V2 1-1-1）。
 *
 * ダッシュボードの「QRを表示」から開く。設計どおり、印刷に使う大きさを
 * 選べるようにしてある。Worker の /api/qr は size と download を受けるので、
 * 保存もそのまま通る。
 *
 * 印刷用PDFだけは受け口が無い。押せない形にして理由を書いた。
 */

const SIZES = [
  { value: '1200x1200', label: '大（1200px）', note: '印刷向け' },
  { value: '600x600', label: '中（600px）', note: '画面向け' },
  { value: '240x240', label: '小（240px）', note: '確認用' },
]

/** Worker の /api/qr が受ける形式。順番はよく使うものから。 */
const FORMATS = [
  { value: 'png', label: 'PNG' },
  { value: 'svg', label: 'SVG' },
  { value: 'jpg', label: 'JPG' },
]

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
    void api.entryRoutes.list().then((res) => {
      // 停止中の経路のQRを配ると、読み取っても友だち追加できない。
      if (!cancelled && res.success) setRoutes(res.data.filter((r) => r.isActive))
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="友だち追加のQRコード"
      onClick={onClose}
    >
      <div
        className="bg-canvas rounded-card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6"
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
            <div className="bg-canvas-sunken rounded-card flex h-[240px] w-[240px] items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- Worker のQRプロキシ。静的アセットではない */}
              <img
                src={qrSrc}
                alt="友だち追加QRコード"
                width={200}
                height={200}
                className="h-[200px] w-[200px]"
              />
            </div>
            <p className="text-ink mt-3 text-sm font-medium">{accountName}</p>
            {profileUrl && (
              <a
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-info mt-1 max-w-[240px] truncate text-xs hover:underline"
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
              <select
                id="qr-route"
                value={routeId}
                onChange={(e) => setRouteId(e.target.value)}
                className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
              >
                <option value="">基本の追加URL</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <p className="text-ink-faint mt-1 text-xs">
                選んだ経路のQRコードとURLが表示されます。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="qr-size" className="text-ink-secondary mb-1 block text-xs font-medium">
                  画像の大きさ
                </label>
                <select
                  id="qr-size"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                >
                  {SIZES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="qr-format" className="text-ink-secondary mb-1 block text-xs font-medium">
                  形式
                </label>
                <select
                  id="qr-format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                >
                  {FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="qr-link"
                className="text-ink-secondary mb-1 block text-xs font-medium"
              >
                友だち追加リンク
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  id="qr-link"
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="border-hairline bg-canvas-sunken text-ink-secondary rounded-control min-w-0 flex-1 truncate border px-3 py-2 font-mono text-xs"
                />
                <button
                  onClick={copy}
                  className="text-on-accent rounded-control shrink-0 px-4 text-xs font-medium"
                  style={{
                    backgroundColor: copied ? 'var(--color-success)' : 'var(--color-accent)',
                  }}
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
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-3 py-2 text-sm font-medium"
              >
                画像を保存
              </a>
              {/* PDFを組み立てる仕組みが無い。 */}
              <button
                disabled
                title="印刷用PDFは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
              >
                印刷用PDF
              </button>
            </div>
          </div>
        </div>

        <div className="border-hairline mt-5 border-t pt-4">
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
