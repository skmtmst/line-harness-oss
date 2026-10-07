'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import GoogleV8, { type MediaUploadHelpers } from '@/v8/restaurant/google/google'
import ListState from '@/components/shared/list-state'
import { extractMediaMetadata, mediaAcceptForKind, putMediaFile, validateMediaFile } from '@/app/contents/media-direct-upload'
import GoogleBusinessPage from './google-business'

/*
 * ★V8 Googleビジネス（板 `j0Wcg`ほか6枚）。完全切り替え：画面は src/v8/restaurant/google。
 * 営業時間の変更・変更の確認・変更履歴・プロフィールの編集（?tab=profile&view=hours|confirm|history|edit）は
 * V8 の絵がまだ無いので、今の画面（google-business）で出す。
 * 端末からの画像アップロードの道具は src/v8 から @/app を読めないので、ここで渡す。
 */
const MEDIA_UPLOAD: MediaUploadHelpers = {
  accept: mediaAcceptForKind('image'),
  validate: validateMediaFile,
  extractMetadata: extractMediaMetadata,
  put: putMediaFile,
}

const PROFILE_SUB_VIEWS = new Set(['hours', 'confirm', 'history', 'edit'])

function GoogleEntry() {
  const searchParams = useSearchParams()
  if (searchParams.get('tab') === 'profile' && PROFILE_SUB_VIEWS.has(searchParams.get('view') ?? '')) return <GoogleBusinessPage />
  return <GoogleV8 mediaUpload={MEDIA_UPLOAD} />
}

export default function Page() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <GoogleEntry />
    </Suspense>
  )
}
