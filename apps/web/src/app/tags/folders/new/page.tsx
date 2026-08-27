'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import TagsPageV4 from '@/components/friend-fields/tags-page-v4'
import TagFolderDialog from '@/components/friend-fields/tag-folder-dialog'
import { usePageTitle } from '@/components/shell/page-chrome'

function FolderRoute() {
  const router = useRouter()
  const params = useSearchParams()
  const editId = params.get('id')
  usePageTitle('友だち属性')

  const close = () => router.push('/tags')
  return (
    <>
      <TagsPageV4 />
      <TagFolderDialog open editId={editId} onClose={close} />
    </>
  )
}

export default function TagFolderPage() {
  return (
    <Suspense fallback={<p className="p-6 text-label text-ink-faint">読み込み中…</p>}>
      <FolderRoute />
    </Suspense>
  )
}
