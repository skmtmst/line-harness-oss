import React from 'react'
import MetricValue from '@/components/ui/metric-value'

type FormKpiValueProps = {
  value: number | null
}

/** 取得できていない数は、実値0と区別して「—」だけを出す（監査6 #674: 見せ方は MetricValue に統一）。 */
export default function FormKpiValue({ value }: FormKpiValueProps) {
  return (
    <p className={`mt-1 text-2xl font-bold ${value === null ? 'text-ink-faint' : 'text-ink'}`}>
      <MetricValue value={value} unit="件" />
    </p>
  )
}
