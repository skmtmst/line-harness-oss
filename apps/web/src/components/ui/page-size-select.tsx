'use client'

import type { SelectHTMLAttributes } from 'react'
import Select from '@/components/shared/select'

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
  label = '表示件数',
  ...rest
}: {
  value: number
  onChange: (value: number) => void
  /** 選べる件数。既定は 20・50・100。 */
  options?: number[]
  className?: string
  /** 板 `apLqS` は字ラベルなし（箱に「20件表示」）。他は今のまま。 */
  label?: string | null
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'className' | 'size'>) {
  // Select は素の select の属性を全部は受けない。呼び出し側は value/onChange
  // だけ使っているが、公開Propsの型は変えず、id/name/disabled だけ中へ渡す。
  const { disabled, id, name } = rest
  return (
    <label className={['flex min-w-0 items-center gap-2', className].filter(Boolean).join(' ')}>
      {label ? <span className="text-ink-faint text-xs whitespace-nowrap">{label}</span> : null}
      <Select
        size="page-size"
        value={String(value)}
        onChange={(next) => onChange(Number(next))}
        aria-label="表示件数"
        options={options.map((n) => ({ value: String(n), label: `${n}件表示` }))}
        id={id}
        name={name}
        disabled={disabled}
      />
    </label>
  )
}
