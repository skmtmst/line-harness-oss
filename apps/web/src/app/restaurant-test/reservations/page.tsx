'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import RestaurantConsole from '../restaurant-console'
import ReservationsPage from '@/v8/restaurant/reservations/reservations'

/* ★V8 切替（板 `l9NlC0`・`Z3FoM`・`rm92Y`・1152 `xzCK6`）。v7 の見た目は data-theme="v8" が付くまで変えない。画面は src/v8/restaurant/reservations。 */
export default function Page() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <ReservationsPage /> : <RestaurantConsole view="reservations" />
}
