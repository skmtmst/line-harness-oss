'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

/**
 * 公式アカウントの看板（表示名とアイコン）。
 *
 * ログイン画面の見出しと、ブラウザのタブの題に出す。どちらも認証より
 * 手前で描くので、認証の要らない /api/public/brand から取る。
 */
export interface Brand {
  name: string | null
  iconUrl: string | null
}

/**
 * 取ったものは持ち回す。看板は画面をまたいで同じで、ログイン画面と
 * タブの題の2か所から呼ばれる。都度取ると LINE API を二重に叩く。
 */
let cache: Brand | null = null
let inflight: Promise<Brand> | null = null

function load(): Promise<Brand> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = api.publicBrand
    .get()
    .then((res) => {
      const next = res.success ? res.data : { name: null, iconUrl: null }
      cache = next
      return next
    })
    // 取れなければ看板なしで進む。呼ぶ側が既定の文字に落とす。
    .catch(() => ({ name: null, iconUrl: null }) as Brand)
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function useBrand(): Brand {
  const [brand, setBrand] = useState<Brand>(cache ?? { name: null, iconUrl: null })

  useEffect(() => {
    let alive = true
    load().then((next) => {
      if (alive) setBrand(next)
    })
    return () => {
      alive = false
    }
  }, [])

  return brand
}
