'use client'

import { Check, ChevronDown, ChevronUp, Search, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

export type InboxSelectOption = {
  value: string
  label: string
  initial?: string
  tone?: 'danger' | 'warning' | 'success' | 'info' | 'neutral'
}

type Props = {
  'aria-label': string
  value: string
  options: InboxSelectOption[]
  onChange: (value: string) => void
  prefix?: string
  searchable?: boolean
  className?: string
}

const toneClasses: Record<NonNullable<InboxSelectOption['tone']>, string> = {
  danger: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-warning',
  success: 'bg-success-bg text-success',
  info: 'bg-info-bg text-info',
  neutral: 'bg-canvas-sunken text-ink-secondary',
}

const dotClasses: Record<NonNullable<InboxSelectOption['tone']>, string> = {
  danger: 'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
  info: 'bg-info',
  neutral: 'bg-ink-faint',
}

/** V6受信箱の担当・対応専用プルダウン（`lJ1CF` / `k6lHgo`）。 */
export default function InboxSelect({
  'aria-label': ariaLabel,
  value,
  options,
  onChange,
  prefix,
  searchable = false,
  className = '',
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value) ?? options[0]
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja')
    if (!normalized) return options
    return options.filter((option) => option.label.toLocaleLowerCase('ja').includes(normalized))
  }, [options, query])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <div
      ref={rootRef}
      className={`relative ${className}`}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false)
      }}
      data-inbox-select={ariaLabel}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex h-9 w-full items-center gap-2 rounded-control border bg-canvas px-3 text-label font-semibold text-ink outline-none ${open ? 'border-accent ring-2 ring-accent/20' : 'border-hairline'}`}
      >
        {selected?.initial ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-v6-avatar-indigo text-caption font-bold text-on-action">{selected.initial}</span>
        ) : selected?.tone ? (
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotClasses[selected.tone]}`} />
        ) : (
          <UserRound aria-hidden="true" size={14} className="shrink-0 text-ink-faint" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{prefix ? `${prefix}：` : ''}{selected?.label ?? ''}</span>
        {open ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1.5 min-w-full rounded-control border border-hairline bg-canvas p-1.5 shadow-lg">
          {searchable ? (
            <label className="relative mb-1.5 block">
              <Search aria-hidden="true" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="担当者名を検索"
                aria-label="担当者名を検索"
                className="h-8 w-full rounded-control border border-hairline bg-canvas pl-8 pr-2 text-caption outline-none focus:border-accent"
              />
            </label>
          ) : null}
          <ul role="listbox" aria-label={ariaLabel} className="grid gap-0.5">
            {visible.map((option) => {
              const selectedOption = option.value === value
              return (
                <li key={option.value} role="option" aria-selected={selectedOption}>
                  <button
                    type="button"
                    onClick={() => choose(option.value)}
                    className={`flex min-h-8 w-full items-center gap-2 rounded-mini px-2.5 py-1.5 text-left text-caption font-semibold ${selectedOption ? option.tone ? toneClasses[option.tone] : 'bg-accent-soft text-accent-deep' : 'text-ink hover:bg-canvas-sunken'}`}
                  >
                    {option.initial ? (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-v6-avatar-indigo text-caption font-bold text-on-action">{option.initial}</span>
                    ) : option.tone ? (
                      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClasses[option.tone]}`} />
                    ) : (
                      <UserRound aria-hidden="true" size={14} className="shrink-0 text-ink-faint" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {selectedOption ? <Check aria-hidden="true" size={14} className="shrink-0" /> : null}
                  </button>
                </li>
              )
            })}
            {visible.length === 0 ? <li className="px-2.5 py-2 text-caption text-ink-faint">該当する担当者はいません</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
