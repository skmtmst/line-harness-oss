import Button from './button'
import Notice from './notice'
import { STALE_STYLE_TEXT } from '@/hooks/use-account-style'

/** 使い方のスタイルを読み直せず、前に読めたスタイルで出している時の 1 行。読み直す口を 1 つだけ持つ。 */
export default function StaleStyleNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-stale-style-notice="">
      <Notice tone="warn" density="compact" role="status" action={<Button size="field" onClick={onRetry}>読み直す</Button>}>
        {`${STALE_STYLE_TEXT}。前に読めた表示で出しています。`}
      </Notice>
    </div>
  )
}
