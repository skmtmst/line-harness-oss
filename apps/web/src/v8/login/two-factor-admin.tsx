'use client'

import { useBrand } from '@/lib/use-brand'
import TwoFactorV8 from './two-factor-ops'

export default function AdminTwoFactorV8() {
  const brand = useBrand()
  return <TwoFactorV8 scope="admin" brandName={brand.name ?? 'musubo'} />
}
