import { redirect } from 'next/navigation'
import { restaurantTestUiEnabled } from '@/lib/environment-features'

export default function RestaurantTestLayout({ children }: { children: React.ReactNode }) {
  if (!restaurantTestUiEnabled()) {
    redirect('/hq')
  }

  return children
}
