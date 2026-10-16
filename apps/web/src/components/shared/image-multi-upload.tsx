'use client'

import type { ComponentProps } from 'react'
import FileDropzone from './file-drop'

/** 複数画像の選択へ手元の画像を追加する入口。形式・入力・ドラッグ処理は共通化する。 */
export default function ImageMultiUpload(props: Omit<ComponentProps<typeof FileDropzone>, 'accept'>) {
  return <FileDropzone accept="image/png,image/jpeg,image/webp" {...props} />
}
