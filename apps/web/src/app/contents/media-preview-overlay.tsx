'use client'

import { useOverlayFocus } from '@/components/shared/overlay-utils'

/*
 * メディアのプレビュー。全面の暗い幕の上に中身だけを出す。
 *
 * 閉じ方は右上の×・Escape・背景を押すの3つ。Tabは中で回り、閉じると
 * 開いたボタンへ焦点が戻る——この3点は共通の useOverlayFocus が担う。
 * 「開いたボタンへ戻る」は hook が開く直前の document.activeElement を
 * 覚えて戻すので、呼び出し側で起点を記録する必要はない。
 */
export default function MediaPreviewOverlay({
  filename,
  kind,
  src,
  onClose,
}: {
  filename: string
  kind: 'image' | 'video' | 'audio' | 'file'
  src: string
  onClose: () => void
}) {
  const overlayRef = useOverlayFocus(true, onClose)
  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${filename}のプレビュー`}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="プレビューを閉じる"
        className="text-on-accent absolute top-4 right-6 text-2xl leading-none"
      >
        ×
      </button>
      {kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={filename} className="max-h-full max-w-full object-contain" />
      ) : kind === 'video' ? (
        <video src={src} controls className="max-h-full max-w-full" />
      ) : kind === 'audio' ? (
        <audio src={src} controls />
      ) : (
        <div className="rounded-card bg-canvas p-6 text-center text-sm">
          <p className="text-ink font-medium">{filename}</p>
          <a href={src} target="_blank" rel="noreferrer" className="text-info mt-2 inline-block hover:underline">
            別のタブで開く
          </a>
        </div>
      )}
    </div>
  )
}
