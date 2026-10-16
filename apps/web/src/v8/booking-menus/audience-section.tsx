'use client'

/*
 * 予約メニューの「見せる相手」（板 L6ifay・B9-1／要件 B9）。
 * 全員（初期）／このタグが付いた人だけ／このタグが付いた人には見せない。タグは「どれか1つ」。
 * 「この人で見る」で友だちを選ぶと、右のお客さまの予約画面の見本から見えないメニューが消え、理由が出る。
 * 保存の口（メニューの audienceMode・audienceTagIds）と見えない理由の口（preview-as）は Codex の次の段。いまは画面の中で判定する。
 */
import { useEffect, useMemo, useState } from 'react'
import Card, { CardHeader } from '@/components/shared/card'
import HelpTip from '@/components/shared/help-tip'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import TagPickerField from '@/components/shared/tag-picker-field'
import { api, type FriendListItem } from '@/lib/api'
import styles from './menu-form.module.css'

export type AudienceMode = 'all' | 'include_tags' | 'exclude_tags'

const MODES: Array<{ value: AudienceMode; label: string }> = [
  { value: 'all', label: '全員に見せる' },
  { value: 'include_tags', label: 'タグが付いた人だけに見せる' },
  { value: 'exclude_tags', label: 'タグが付いた人には見せない' },
]

/** その人にこのメニューが見えるか。見えないときは理由の文（タグ名つき）を返す。 */
export function audienceVisibility(mode: AudienceMode, tagIds: readonly string[], friendTagIds: readonly string[], tagName: (id: string) => string): { visible: true } | { visible: false; reason: string } {
  if (mode === 'all' || tagIds.length === 0) return { visible: true }
  const hit = tagIds.filter((id) => friendTagIds.includes(id))
  if (mode === 'include_tags') {
    return hit.length > 0 ? { visible: true } : { visible: false, reason: `タグ「${tagIds.map(tagName).join('」「')}」がありません` }
  }
  return hit.length === 0 ? { visible: true } : { visible: false, reason: `タグ「${hit.map(tagName).join('」「')}」が付いています` }
}

export function AudienceSection({ accountId, mode, tagIds, onMode, onTagIds, canEdit, friendId, onFriendId, onFriends }: {
  accountId: string | null
  mode: AudienceMode
  tagIds: string[]
  onMode: (mode: AudienceMode) => void
  onTagIds: (ids: string[]) => void
  /** 変えられるのはオーナー・管理者だけ。閲覧のみ・スタッフは見るだけ（この人で見るは使える）。 */
  canEdit: boolean
  friendId: string
  onFriendId: (id: string) => void
  /** 選べる友だちを親へ渡す（右の見本の判定に使う）。 */
  onFriends: (friends: FriendListItem[]) => void
}) {
  const [friends, setFriends] = useState<FriendListItem[]>([])
  useEffect(() => {
    if (!accountId) return
    let live = true
    void api.friends.list({ accountId, limit: 30 }).then((res) => {
      if (live && res.success) { setFriends(res.data.items); onFriends(res.data.items) }
    }, () => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])
  const options = useMemo(() => [{ value: '', label: 'この人で見る：選ばない（全員の見本）' }, ...friends.map((friend) => ({ value: friend.id, label: `この人で見る：${friend.displayName}さん` }))], [friends])
  return (
    <Card variant="form" gap="normal">
      <CardHeader size="stacked" title={<span className={styles.titleWithMark}>見せる相手<HelpTip label="見せる相手の説明">会員だけ・初めての人だけ・常連だけのメニューを出し分けます。タグは「どれか1つ」が付いていれば当てはまります。</HelpTip><StatusBadge tone="success" dot={false} size="compact">足した物</StatusBadge></span>} />
      <div role="radiogroup" aria-label="見せる相手" className={styles.fieldStack}>
        {MODES.map((item) => (
          <label key={item.value} className={styles.audienceRow}>
            <input type="radio" name="booking-menu-audience" value={item.value} checked={mode === item.value} disabled={!canEdit} onChange={() => onMode(item.value)} />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
      {mode !== 'all' ? (
        <TagPickerField label="見せる相手のタグ" value={tagIds} onChange={onTagIds} accountId={accountId} readOnly={!canEdit} />
      ) : null}
      <div className={styles.audiencePreview}>
        <span className={styles.ruleLabel}>右の予約画面の見本：</span>
        <Select aria-label="この人で見る" size="full" value={friendId} onChange={onFriendId} options={options} />
      </div>
      <p className={styles.ruleLabel}>タグが外れたら次の予約から見えなくなります。今ある予約はそのままです。</p>
    </Card>
  )
}
