'use client'

import { useCallback, useState, type SelectHTMLAttributes } from 'react'
import Select from '@/components/shared/select'

/** 夕28: 一覧の右上に出す件数の選択肢は全画面で 10・20・50 にそろえる。 */
export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

const PAGE_SIZE_STORAGE_PREFIX = 'lh-page-size:'

/**
 * 選んだ件数を画面ごとに覚える（夕28「選んだ件数は画面ごとに覚える」）。
 * `key` は画面を表す短い名前（`tags`・`scenarios` など）。
 * 保存できない環境（プライベートモード等）では、その画面の中だけで効く。
 */
export function usePageSize(key: string, fallback = 20): [number, (next: number) => void] {
  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined') return fallback
    try {
      const stored = Number(window.localStorage.getItem(PAGE_SIZE_STORAGE_PREFIX + key))
      return (PAGE_SIZE_OPTIONS as readonly number[]).includes(stored) ? stored : fallback
    } catch {
      return fallback
    }
  })
  const update = useCallback((next: number) => {
    setSize(next)
    try {
      window.localStorage.setItem(PAGE_SIZE_STORAGE_PREFIX + key, String(next))
    } catch {
      // 保存できなくても選んだ値はこの画面では効く
    }
  }, [key])
  return [size, update]
}

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
  // Select は素の select の属性を全部は受けない。呼び出し側は value/onChange
  // だけ使っているが、公開Propsの型は変えず、id/name/disabled だけ中へ渡す。
  const { disabled, id, name } = rest
  return (
    <label className={['flex min-w-0 items-center gap-2', className].filter(Boolean).join(' ')}>
      <span className="text-ink-faint text-xs whitespace-nowrap">表示件数</span>
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
