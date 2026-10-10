'use client'

import MediaSlot, { type MediaSlotProps } from './media-slot'
import styles from './image-frame.module.css'

/** B-178 mUGhx/symCA：画像の枠。取り込み・失敗・権限はMediaSlotを共有する。 */
export default function ImageFrame(props: Omit<MediaSlotProps, 'kind' | 'size' | 'aspectRatio'>) {
  return <div className={styles.frame} data-shared-part="image-frame" data-image-frame><MediaSlot {...props} kind="image" size="compact" aspectRatio="160 / 106" /></div>
}
