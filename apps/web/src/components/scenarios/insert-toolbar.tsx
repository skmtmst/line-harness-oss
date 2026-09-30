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
import { useAccount } from '@/contexts/account-context'
import { useFeatureVisibility } from '@/lib/use-feature-visibility'
import { scenarioReferenceData } from './scenario-reference-data'
import DateField from '@/components/shared/date-field'
import MenuPortal from '@/components/shared/menu-portal'
import Button from '@/components/shared/button'

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
  /** 一斉配信の本文編集で、設計上の回答フォーム差し込み口を表示する。 */
  includeAnswerForm?: boolean
}

export default function InsertToolbar({ targetRef, value, onChange, includeAnswerForm = false }: InsertToolbarProps) {
  const { selectedAccountId } = useAccount()
  // 友だち情報・共通情報は任意機能。オフのaccountでは差し込み口ごと出さない。
  const featureVisibility = useFeatureVisibility(selectedAccountId)
  const fieldsEnabled = featureVisibility.enabled('friend_fields')
  const varsEnabled = featureVisibility.enabled('common_vars')
  const [open, setOpen] = useState<string | null>(null)
  const [fields, setFields] = useState<Option[]>([])
  const [vars, setVars] = useState<Option[]>([])
  const [targetDate, setTargetDate] = useState('')
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    if (!selectedAccountId) {
      setVars([])
      return
    }
    void (async () => {
      const [fieldRes, varRes] = await Promise.all([
        fieldsEnabled
          ? scenarioReferenceData.friendFields(selectedAccountId)
          : Promise.resolve({ success: false as const }),
        varsEnabled
          ? scenarioReferenceData.commonVars(selectedAccountId)
          : Promise.resolve({ success: false as const }),
      ])
      if (fieldRes.success) {
        setFields(fieldRes.data.map((f) => ({ token: `{{field.${f.fieldKey}}}`, label: f.name })))
      }
      if (varRes.success) {
        setVars(varRes.data.map((v) => ({ token: `{{var.${v.varKey}}}`, label: v.name })))
      }
    })()
  }, [selectedAccountId, fieldsEnabled, varsEnabled])

  // 外を押したら閉じる扱いは MenuPortal に任せる（箱の中の押しで閉じない）。
  // 開くボタンの押し直しはトグルになる。

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

  const menuButton = (key: string, label: string, token?: string) => (
    <Button variant="secondary" className={(`border-hairline rounded-control h-8 border px-2.5 text-xs transition-colors ${
        open === key ? 'bg-accent-soft text-accent-deep border-accent' : 'text-ink-secondary hover:bg-canvas-sunken'
      }`) + ' whitespace-normal'} type="button" ref={(element) => {
        buttonRefs.current[key] = element
      }} onClick={() => token ? insert(token) : setOpen(open === key ? null : key)} aria-expanded={open === key}>
      {label}
    </Button>
  )

  const list = (menuKey: string, items: Option[], empty: string) => (
    <MenuPortal
      open={open === menuKey}
      align="start"
      getAnchor={() => buttonRefs.current[menuKey] ?? null}
      onClose={() => setOpen(null)}
    >
      <div
        className="border-hairline rounded-card bg-canvas max-h-64 w-64 overflow-y-auto border shadow-float"
        // 最上層では absolute 指定を無効にする（位置は器が決める）。
        style={{ position: 'static' }}
      >
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
    </MenuPortal>
  )

  return (
    <div className="relative flex flex-wrap items-center gap-1.5">
      <span className="text-ink-faint text-xs">差し込み</span>

      <Button variant="secondary" className="text-ink-secondary h-8 px-2.5 text-xs whitespace-normal" type="button" onClick={() => insert('{{name}}')}>
        名前
      </Button>

      {fieldsEnabled && (
        <div className="relative">
          {menuButton('field', '友だち情報')}
          {list('field', fields, '友だち情報欄がまだありません')}
        </div>
      )}

      {varsEnabled && (
        <div className="relative">
          {menuButton('var', '共通情報')}
          {list('var', vars, '共通情報がまだありません')}
        </div>
      )}

      {includeAnswerForm && menuButton('answer-form', '回答フォーム', '{{answer_form}}')}

      <div className="relative">
        {menuButton('date', '配信日')}
        {list(
          'date',
          DATE_FORMATS.map((f) => ({ token: f.token, label: f.label, hint: f.example })),
          '',
        )}
      </div>

      <div className="relative">
        {menuButton('other', 'その他')}
        <MenuPortal
          open={open === 'other'}
          align="start"
          getAnchor={() => buttonRefs.current.other ?? null}
          onClose={() => setOpen(null)}
        >
          <div
            className="border-hairline rounded-card bg-canvas w-72 border p-3 shadow-float"
            // 最上層では absolute 指定を無効にする（位置は器が決める）。
            style={{ position: 'static' }}
          >
            <p className="text-ink text-xs font-medium">目標日までの日数</p>
            <p className="text-ink-faint mt-0.5 mb-2 text-xs leading-relaxed">
              「あと3日」のように出ます。配信のたびに数え直すので、書き換えは要りません。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <DateField
                value={targetDate}
                onChange={setTargetDate}
                aria-label="目標日"
                className="min-w-0 flex-1"
              />
              <Button variant="secondary" className="text-ink-secondary h-8 shrink-0 px-3 text-xs whitespace-normal" type="button" disabled={!targetDate} onClick={() => insert(`{{days_until:${targetDate}}}`)}>
                入れる
              </Button>
            </div>

            <p className="text-ink text-xs font-medium mt-3">配信日から何日後かの日付</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[1, 3, 7, 14, 30].map((n) => (
                <Button variant="secondary" className="text-ink-secondary h-8 px-2.5 text-xs whitespace-normal" key={n} type="button" onClick={() => insert(`{{date+${n}}}`)}>
                  {n}日後
                </Button>
              ))}
            </div>
          </div>
        </MenuPortal>
      </div>
    </div>
  )
}
