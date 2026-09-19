import type { SelectHTMLAttributes } from 'react'
import styles from './select-field.module.css'

export interface SelectOption {
  value: string
  label: string
}

/**
 * 標準プルダウン。Pencil V5 の `rpot9`。★V5 227枚で176回。
 *
 * `size="compact"` は一覧上の件数切り替え `niGPF`「20件表示」。
 * 形は同じで既定の幅だけが違う（176 と 128）。
 *
 * 幅を画面ごとに決めたいときは `className="w-full"` などを渡す。
 * その場合 `size` の既定幅は上書きされる。
 */
export default function SelectField({
  options,
  size = 'default',
  className,
  ...rest
}: {
  options: SelectOption[]
  size?: 'default' | 'compact'
  className?: string
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children' | 'size'>) {
  return (
    <select className={[styles.select, styles[size], className].filter(Boolean).join(' ')} {...rest}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
