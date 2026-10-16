'use client'
import type { ComponentProps } from 'react'
import FolderPanel from './folder-panel'

/** スタイルなどの固定分類。フォルダを作る・変える操作を持たない。 */
export default function CategoryPanel(props: Pick<ComponentProps<typeof FolderPanel>, 'heading' | 'showHeading' | 'rows' | 'activeId' | 'onSelect'>) {
  return <FolderPanel {...props} />
}
