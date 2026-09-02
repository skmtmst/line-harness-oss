import React from 'react'

type FormKpiValueProps = {
  value: number | null
}

/** 取得できていない数は、実値0と区別して「—」だけを出す。 */
export default function FormKpiValue({ value }: FormKpiValueProps) {
  return (
    <p className={`mt-1 text-2xl font-bold tabular-nums ${value === null ? 'text-ink-faint' : 'text-ink'}`}>
      {value === null ? '—' : value.toLocaleString('ja-JP')}
      {value !== null && <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>}
    </p>
  )
}
