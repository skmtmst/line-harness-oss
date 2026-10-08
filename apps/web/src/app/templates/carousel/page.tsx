'use client'

import { Suspense } from 'react'
import ListState from '@/components/shared/list-state'
import CarouselEditorV8 from '@/v8/templates/carousel'

/** 次のリリースはV8。URLと機能ゲートを保って既存のV8画面へ渡す。 */
function Page() {
  return <Suspense fallback={<ListState kind="loading" />}><CarouselEditorV8 /></Suspense>
}

import { buildCarouselActions, buildCarouselContent, saveCarousel } from '@/v8/templates/carousel-core'

export default Object.assign(Page, { __testing: { CarouselEditorInner: CarouselEditorV8, buildCarouselActions, buildCarouselContent, saveCarousel } })
