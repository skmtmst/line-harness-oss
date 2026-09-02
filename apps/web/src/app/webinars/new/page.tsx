'use client'

import Link from 'next/link'
import Header from '@/components/layout/header'
import WebinarForm from '@/components/webinars/webinar-form'

export default function NewWebinarPage() {
  return (
    <>
      <nav data-design="Crumb" className="text-ink-faint px-6 pt-4 text-xs">
        <Link href="/webinars" className="hover:underline">
          ウェビナー
        </Link>
        <span className="mx-1.5">/</span>
        <span>新規作成</span>
      </nav>
      <div data-design="Head">
        <Header
          title="ウェビナーを作る"
          description="録画と配信枠を設定すると、友だちが「今始まったばかり」の状態で視聴できます。"
        />
      </div>
      <div className="p-6">
        <WebinarForm />
      </div>
    </>
  )
}
