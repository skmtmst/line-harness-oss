import ListState from '@/components/shared/list-state'
import { PageContent, PageFrame } from './page-frame'

/** 画面をまだ出せない間の共通の骨組み。画面名は外側の帯に任せる。 */
export default function PagePending({ failed = false, onRetry, stage = 'identity' }: { failed?: boolean; onRetry?: () => void; stage?: 'identity' | 'route' | 'root' | 'store' | 'handover' }) {
  return <PageFrame kind="detail"><PageContent data-page-pending={stage}><ListState kind={failed ? 'error' : 'loading'} onRetry={onRetry} /></PageContent></PageFrame>
}
