'use client'

import React, { useState } from 'react'
import ActionMenu from '@/components/shared/action-menu'

/**
 * 保存した検索1件ぶんの「…」（設計 `ASsb3` 2-13）。
 *
 * **赤字の「削除」を名前の隣に直に並べていた。** 選ぶつもりで押し間違える
 * 並びだったので、名前を変える・消すをここへ畳む。
 */
export default function SavedViewRowMenu({
  name,
  onRename,
  onDelete,
}: {
  name: string
  onRename: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`「${name}」の操作`}
        aria-expanded={open}
        data-qa-open="ASsb3"
        className="text-ink-faint hover:text-accent hover:bg-canvas-sunken rounded px-1.5 py-1 text-sm leading-none"
      >
        …
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50">
          <ActionMenu
            open
            ariaLabel={`「${name}」の操作`}
            items={[
              { id: 'rename', label: '名前を変える', onSelect: () => { setOpen(false); onRename() } },
              { id: 'delete', label: '消す', tone: 'danger', onSelect: () => { setOpen(false); onDelete() } },
            ]}
            note="消しても、絞り込みの条件そのものは残ります。"
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
