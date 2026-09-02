import React from 'react'
import SummaryCard, { type SummaryCardProps } from '@/components/shared/summary-card'

/**
 * 既存画面の呼び出し方を保ったまま共通SummaryCardへつなぐ互換層。
 * この部品の利用画面にはV6があるため、既定はV6にする。
 */
export default function KpiCard({ variant = 'v6', ...props }: SummaryCardProps) {
  return <SummaryCard variant={variant} {...props} />
}
