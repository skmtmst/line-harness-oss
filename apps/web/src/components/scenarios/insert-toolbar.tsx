'use client'

/*
 * 差し込みを本文に入れるボタン。
 *
 * 記法（{{field.pet_name}} のような書き方）を覚えないと使えない、という
 * のがこれまでの状態だった。使えるのに誰も使わない機能になっていたので、
 * 押して入れられるようにする。
 *
 * **カーソルの位置に入れる。** 末尾に足す作りにすると、文の途中に入れたい
 * ときに一度書いてから切り貼りすることになる。
 *
 * 並びは Lステップの本文まわりに合わせてある（名前 / 友だち情報 /
 * 共通情報 / 配信日 / その他）。回答フォームはこちらに受け口が無いので出さない。
 */

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

/** 日付の書き方。worker の interpolation-date.ts と同じ並び。 */
const DATE_FORMATS: { token: string; label: string; example: string }[] = [
  { token: '{{date}}', label: '月日と曜日', example: '8月20日(水)' },
  { token: '{{date:ymd_w}}', label: '年月日と曜日', example: '2026年8月20日(水)' },
  { token: '{{date:md}}', label: '月日', example: '8月20日' },
  { token: '{{date:ymd}}', label: '年月日', example: '2026年8月20日' },
  { token: '{{date:slash_md_w}}', label: '月日と曜日（スラッシュ）', example: '8/20(水)' },
  { token: '{{date:slash_ymd_w}}', label: '年月日と曜日（スラッシュ）', example: '2026/8/20(水)' },
  { token: '{{date:slash_md}}', label: '月日（スラッシュ）', example: '8/20' },
  { token: '{{date:slash_ymd}}', label: '年月日（スラッシュ）', example: '2026/8/20' },
]

interface Option {
  token: string
  label: string
  hint?: string
}

export interface InsertToolbarProps {
  /** 差し込み先。入力欄そのものを渡す。 */
  targetRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>
  value: string
  onChange: (next: string) => void
}

export default function InsertToolbar({ targetRef, value, onChange }: InsertToolbarProps) {
  const [open, setOpen] = useState<string | null>(null)
  const [fields, setFields] = useState<Option[]>([])
  const [vars, setVars] = useState<Option[]>([])
  const [targetDate, setTargetDate] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void (async () => {
      const [fieldRes, varRes] = await Promise.all([api.friendFields.list(), api.commonVars.list()])
      if (fieldRes.success) {
        setFields(fieldRes.data.map((f) => ({ token: `{{field.${f.fieldKey}}}`, label: f.name })))
      }
      if (varRes.success) {
        setVars(varRes.data.map((v) => ({ token: `{{var.${v.varKey}}}`, label: v.name })))
      }
    })()
  }, [])

  // 外を押したら閉じる。開いたままだと下の入力欄が押せない。
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  /**
   * カーソルの位置に入れる。
   *
   * 入れたあとはカーソルを差し込みの直後へ置く。先頭に戻ると、続けて
   * 書こうとしたときに文頭へ打ち込むことになる。
   */
  const insert = (token: string) => {
    const el = targetRef.current
    if (!el) {
      onChange(value + token)
      setOpen(null)
      return
    }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    const next = value.slice(0, start) + token + value.slice(end)
    onChange(next)
    setOpen(null)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  const menuButton = (key: string, label: string) => (
    <button
      type="button"
      onClick={() => setOpen(open === key ? null : key)}
      aria-expanded={open === key}
      className={`border-hairline rounded-control h-8 border px-2.5 text-xs transition-colors ${
        open === key ? 'bg-accent-soft text-accent border-accent' : 'text-ink-secondary hover:bg-canvas-sunken'
      }`}
    >
      {label}
    </button>
  )

  const list = (items: Option[], empty: string) => (
    <div className="border-hairline rounded-card absolute z-20 mt-1 max-h-64 w-64 overflow-y-auto border bg-white shadow-lg">
      {items.length === 0 ? (
        <p className="text-ink-faint px-3 py-4 text-center text-xs">{empty}</p>
      ) : (
        items.map((o) => (
          <button
            key={o.token}
            type="button"
            onClick={() => insert(o.token)}
            className="hover:bg-canvas-sunken block w-full px-3 py-2 text-left text-xs"
          >
            <span className="text-ink block">{o.label}</span>
            {o.hint && <span className="text-ink-faint block">{o.hint}</span>}
          </button>
        ))
      )}
    </div>
  )

  return (
    <div ref={wrapRef} className="relative flex flex-wrap items-center gap-1.5">
      <span className="text-ink-faint text-xs">差し込み</span>

      <button
        type="button"
        onClick={() => insert('{{name}}')}
        className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-8 border px-2.5 text-xs"
      >
        名前
      </button>

      <div className="relative">
        {menuButton('field', '友だち情報')}
        {open === 'field' &&
          list(fields, '友だち情報欄がまだありません')}
      </div>

      <div className="relative">
        {menuButton('var', '共通情報')}
        {open === 'var' && list(vars, '共通情報がまだありません')}
      </div>

      <div className="relative">
        {menuButton('date', '配信日')}
        {open === 'date' &&
          list(
            DATE_FORMATS.map((f) => ({ token: f.token, label: f.label, hint: f.example })),
            '',
          )}
      </div>

      <div className="relative">
        {menuButton('other', 'その他')}
        {open === 'other' && (
          <div className="border-hairline rounded-card absolute z-20 mt-1 w-72 border bg-white p-3 shadow-lg">
            <p className="text-ink text-xs font-bold">目標日までの日数</p>
            <p className="text-ink-faint mt-0.5 mb-2 text-xs leading-relaxed">
              「あと3日」のように出ます。配信のたびに数え直すので、書き換えは要りません。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="border-hairline rounded-control text-ink h-8 min-w-0 flex-1 border px-2 text-xs"
              />
              <button
                type="button"
                disabled={!targetDate}
                onClick={() => insert(`{{days_until:${targetDate}}}`)}
                className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-8 shrink-0 border px-3 text-xs disabled:opacity-40"
              >
                入れる
              </button>
            </div>

            <p className="text-ink text-xs font-bold mt-3">配信日から何日後かの日付</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[1, 3, 7, 14, 30].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => insert(`{{date+${n}}}`)}
                  className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control h-8 border px-2.5 text-xs"
                >
                  {n}日後
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
