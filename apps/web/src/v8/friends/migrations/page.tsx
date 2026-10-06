'use client'

/*
 * ★V8 /friends/migrations の入口。`?tab=uid` は UID移行、それ以外は CSV で書き出す・取り込む。
 */
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import CsvMigrationsV8 from './csv'

function Inner() {
  const tab = useSearchParams().get('tab')
  if (tab === 'uid') return <CsvMigrationsV8 />
  return <CsvMigrationsV8 />
}

export default function FriendMigrationsV8() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  )
}
