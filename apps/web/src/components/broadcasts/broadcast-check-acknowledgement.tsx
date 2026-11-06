import Checkbox from '@/components/shared/checkbox'
import Notice from '@/components/shared/notice'
import { formatNumber } from '@/lib/format'

/** 未実施のテストを強制せず、残っている注意を読んだことを確かめる。 */
export default function BroadcastCheckAcknowledgement({ issues, checked, onCheckedChange, disabled }: {
  issues: string[]
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled: boolean
}) {
  if (issues.length === 0) return null
  return <div className="space-y-3">
    <Notice tone="warn">
      <p className="font-semibold">配信前チェックに {formatNumber(issues.length)}件 の未確認があります</p>
      <ul className="mt-1 list-disc pl-4">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
    </Notice>
    <Checkbox checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}
      description={checked ? undefined : '未確認の内容を読み、チェックすると送信・予約できます。'}>確認しました</Checkbox>
  </div>
}
