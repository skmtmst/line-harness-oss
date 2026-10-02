'use client'

import { X } from 'lucide-react'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import Button from '@/components/shared/button'

export type FriendsNotice = { title: string; message: string }

/**
 * 友だち画面の短い通知窓（N-039）。
 *
 * 共通overlay規約（components/shared/overlay-utils）に合わせる：
 * Escで閉じる・開いたら中の最初の押し口へフォーカス・Tabは窓の中で
 * 回す・閉じたら開く前の場所へフォーカスを戻す・背景のスクロールは止める。
 * 以前は外側クリックでしか閉じられず、キーボードだけでは抜けられなかった。
 */
export default function NoticeDialog({
  notice,
  onClose,
}: {
  notice: FriendsNotice
  onClose: () => void
}) {
  const panelRef = useOverlayFocus(true, onClose)

  return (
    <div
      className="fixed inset-0 z-70 flex items-center justify-center bg-ink/35 p-4"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="friends-notice-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-panel border border-hairline bg-canvas p-5 shadow-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="friends-notice-title" className="text-lg font-bold text-ink">
            {notice.title}
          </h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">{notice.message}</p>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={onClose}>
            確認
          </Button>
        </div>
      </section>
    </div>
  )
}
