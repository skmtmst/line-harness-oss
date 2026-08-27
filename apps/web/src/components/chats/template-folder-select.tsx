'use client'

import { Check, ChevronDown, ChevronRight, ChevronUp, Folder } from 'lucide-react'
import { useRef, useState } from 'react'
import Button from '@/components/shared/button'

export type TemplateFolderOption = {
  value: string
  label: string
  count: number
  depth?: number
}

/** V6受信箱のテンプレート用フォルダ選択（`NWbuF` / `TUveA`）。 */
export default function TemplateFolderSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: TemplateFolderOption[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value) ?? options[0]

  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      data-template-folder-select
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <div className={`rounded-control ${open ? 'ring-2 ring-accent/20' : ''}`}>
        <Button
          aria-label="テンプレートのフォルダ"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="w-full"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Folder aria-hidden="true" size={15} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 flex-1 truncate text-left">{selected?.label ?? 'すべてのフォルダ'}</span>
            {open ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
          </span>
        </Button>
      </div>

      {open ? (
        <ul
          role="listbox"
          aria-label="テンプレートのフォルダ"
          className="absolute right-0 top-full z-50 mt-1.5 max-h-72 min-w-64 overflow-y-auto rounded-control border border-hairline bg-canvas p-1.5 shadow-lg"
        >
          {options.map((option) => {
            const selectedOption = option.value === value
            return (
              <li key={option.value} role="option" aria-selected={selectedOption}>
                <button
                  type="button"
                  onClick={() => choose(option.value)}
                  className={`flex min-h-9 w-full items-center gap-2 rounded-mini px-2.5 py-1.5 text-left text-caption ${selectedOption ? 'bg-accent-soft font-bold text-accent-deep' : 'font-medium text-ink hover:bg-canvas-sunken'}`}
                >
                  {option.depth ? (
                    <ChevronRight aria-hidden="true" size={13} className="ml-3 shrink-0 text-ink-faint" />
                  ) : (
                    <Folder aria-hidden="true" size={14} className="shrink-0 text-ink-faint" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="shrink-0 tabular-nums text-ink-faint">{option.count}</span>
                  {selectedOption ? <Check aria-hidden="true" size={14} className="shrink-0" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
