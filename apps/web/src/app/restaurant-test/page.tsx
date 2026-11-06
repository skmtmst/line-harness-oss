import { redirect } from 'next/navigation'
import { legacyRouteDestination } from '@/lib/canonical-route'

export default function Page() {
  redirect(legacyRouteDestination('/restaurant-test'))
}
