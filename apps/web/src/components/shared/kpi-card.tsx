import React from 'react'
import SummaryCard, { type SummaryCardProps } from './summary-card'

/** V6一覧のKPI。0は実数、nullだけを未取得（—）として共通表示する。 */
export default function KpiCard({ variant = 'v6', ...props }: SummaryCardProps) {
  return <SummaryCard variant={variant} {...props} />
}

export type { SummaryCardProps as KpiCardProps }
