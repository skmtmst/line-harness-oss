'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'
import RestaurantConsole from '../restaurant-console'
import ReservationsV8 from '../v8/reservations'

/* ★V8 切替（板 `Z3FoM`・`l9NlC0`・`rm92Y`）。v7 の見た目は data-theme="v8" が付くまで変えない。 */
export default function Page() {
  const theme = useAdminTheme()
  return theme === 'v8' ? <ReservationsV8 /> : <RestaurantConsole view="reservations" />
}
