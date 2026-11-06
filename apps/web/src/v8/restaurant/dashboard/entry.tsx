'use client'
import { useSearchParams } from 'next/navigation'
import { StyleDashboard } from '@/v8/style-dashboard/public/style-dashboard/index'
import StoresDashboardV8 from './stores'

/** 飲食店の入口。`?view=stores` のときは全店の一覧（CHz31）、それ以外は飲食の業種ダッシュボード（NqAvL）。 */
export default function RestaurantDashboard() {
  const params = useSearchParams()
  return params.get('view') === 'stores' ? <StoresDashboardV8 /> : <StyleDashboard style="restaurant" />
}
