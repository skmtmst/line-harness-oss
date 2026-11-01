// @vitest-environment happy-dom
import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { StyleMetric, StyleSnapshot } from '@line-crm/shared'
import KpiCard from '@/components/shared/kpi-card'
import { kpisFor, metricValue } from './adapter'
import { selectedKpis } from './metric-selection'

afterEach(cleanup)
const snapshot = (metric?: StyleMetric): StyleSnapshot => ({
  style: 'restaurant', from: '2026-10-31T15:00:00Z', to: '2026-11-01T15:00:00Z',
  asOf: '2026-11-01T01:30:00Z', timeZone: 'Asia/Tokyo', range: 'today', dateBasis: 'visit',
  metrics: metric ? { freeTables: metric } : {}, previous: {}, items: [], newBookings: [], resultId: 'tables',
})
const metric = (value: number | null, totalTables?: number): StyleMetric => ({
  value, totalTables, unit: '卓', formula: '有効卓のうち現在の予約が重なっていない卓',
  status: value === null ? 'unconfigured' : 'available',
})

it.each([[1, 3], [0, 3], [0, 0], [1200, 2000]])('空席%sと同じ対象の%s卓を既定と選択済みの帯で示す', (value, total) => {
  const data = snapshot(metric(value, total))
  const free = kpisFor('restaurant', data, 'today').find(item => item.metricId === 'freeTables')!
  expect(free).toMatchObject({ value, unit: '卓', detail: `動いている${total.toLocaleString('ja-JP')}卓中` })
  expect(selectedKpis('restaurant', data, 'today', ['freeTables'])).toEqual([free])
  render(<KpiCard title={free.title} value={free.value} unit={free.unit} detail={free.detail} detailLayout="single" />)
  expect(screen.getByText(free.detail)).toBeTruthy()
  expect(metricValue(data.metrics.freeTables)).toMatchObject({ value, unit: '卓' })
})

it.each([undefined, -1, 1.5, NaN, Infinity])('旧応答や不正な総数%sを0や満席と補わない', total => {
  const data = snapshot(metric(0, total))
  expect(selectedKpis('restaurant', data, 'today', ['freeTables'])[0]).toMatchObject({ value: 0, unit: '卓', detail: '卓の総数は未取得' })
})

it('空席が未設定なら総数より既存の未設定理由を優先する', () => {
  expect(selectedKpis('restaurant', snapshot(metric(null, 3)), 'today', ['freeTables'])[0]).toMatchObject({ value: null, detail: '未設定です' })
  expect(selectedKpis('restaurant', snapshot(), 'today', ['freeTables'])[0]).toMatchObject({ value: null, detail: '口から返っていません' })
})
