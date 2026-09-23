'use client'

import type { SelectHTMLAttributes } from 'react'
import SelectField from '@/components/shared/select-field'

/**
 * 一覧ツールバーの表示件数（監査 #668）。
 *
 * 「表示件数」の字ラベルと `{N}件表示` の選択肢を1形にする。
 * 以前は画面ごとに「20件表示」「20件」「2件を表示」と書き方が違い、
 * 押せるのか表示だけなのか読み分けられなかった。
 * 選択肢の「件表示」は設計（design-structure.json）側の語でもある。
 * 押せない件数はこの部品ではなく `ListRange` の仕事。
 */
export default function PageSizeSelect({
  value,
  onChange,
  options = [20, 50, 100],
  className,
  ...rest
}: {
  value: number
  onChange: (value: number) => void
  /** 選べる件数。既定は 20・50・100。 */
  options?: number[]
  className?: string
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'className' | 'size'>) {
  return (
    <label className={['flex min-w-0 items-center gap-2', className].filter(Boolean).join(' ')}>
      <span className="text-ink-faint text-xs whitespace-nowrap">表示件数</span>
      <SelectField
        size="compact"
        value={String(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="表示件数"
        options={options.map((n) => ({ value: String(n), label: `${n}件表示` }))}
        className="w-auto min-w-24 max-w-full"
        {...rest}
      />
    </label>
  )
}
