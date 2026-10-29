import type { ButtonHTMLAttributes } from 'react'
import Button from '@/components/shared/button'
import MediaThumbnail from '@/components/shared/media-thumbnail'
import TruncatedText from '@/components/shared/truncated-text'
import { ErrorCountBadge } from '@/components/shared/error-count-badge'
import styles from './carousel.module.css'

export default function CarouselOrderChip({ index, label, src, errorCount, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> & {
  index: number; label: string; src: string; errorCount: number; lockedReason?: string
}) {
  return <Button {...props} type="button" className={styles.chip} aria-label={`${label}${errorCount ? `（直す欄が${errorCount}か所）` : ''}`}>
    <span className={styles.chipImage}><MediaThumbnail kind="image" size="compact" src={src} alt="" /></span>
    <span className={styles.chipTitle}><TruncatedText value={label} /></span>
    <ErrorCountBadge count={errorCount} label={`カード${index + 1}`} />
  </Button>
}
