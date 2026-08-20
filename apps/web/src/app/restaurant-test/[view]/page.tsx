import RestaurantConsole from '../restaurant-console'

const views = ['dashboard', 'organization', 'approvals', 'reservations', 'tables', 'inventory', 'menu', 'google', 'line-followup']

export function generateStaticParams() {
  return views.map((view) => ({ view }))
}

export default async function RestaurantTestPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params
  return <RestaurantConsole view={view} />
}
