import ListState from '@/components/shared/list-state'
import { PageContent, PageFrame } from './page-frame'

/** 画面をまだ出せない間の共通の骨組み。画面名は外側の帯に任せる。 */
export default function PagePending({ failed = false, onRetry }: { failed?: boolean; onRetry?: () => void }) {
  return <PageFrame kind="detail"><PageContent><ListState kind={failed ? 'error' : 'loading'} onRetry={onRetry} /></PageContent></PageFrame>
}
