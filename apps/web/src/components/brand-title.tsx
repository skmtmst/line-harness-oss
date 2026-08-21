'use client'
import { useEffect } from 'react'
import { useBrand } from '@/lib/use-brand'

/**
 * ブラウザのタブの題を公式アカウントの表示名にする。
 *
 * layout.tsx の metadata は書き出しの時点で決まるので、そこには
 * 名前を入れられない（LINE から取るまで分からない）。metadata 側は
 * 既定の名前を置いておき、取れた時点でここが差し替える。
 *
 * 何も描かない。副作用だけの部品。
 */
export default function BrandTitle() {
  const brand = useBrand()

  useEffect(() => {
    if (brand.name) document.title = brand.name
  }, [brand.name])

  return null
}
