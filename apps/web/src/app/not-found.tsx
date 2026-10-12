'use client'

import { usePageTitle } from '@/components/shell/page-chrome'
import NotFoundV8 from '@/v8/not-found/not-found'

export default function NotFound() {
  usePageTitle('ページが見つかりません')
  return <NotFoundV8 />
}
