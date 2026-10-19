'use client'

import Avatar from './avatar'
import Button from './button'
import Notice from './notice'
import styles from './friend-filter-band.module.css'

/**  E1：名前は画面にだけ出し、移動先へ渡すのは友だちIDだけ。 */
export function friendFilterHref(path: string, friendId: string | null) {
  const url = new URL(path, 'https://line-harness.invalid')
  if (url.origin !== 'https://line-harness.invalid') throw new Error('一覧の移動先は管理画面内を指定してください')
  if (friendId) url.searchParams.set('friendId', friendId)
  else url.searchParams.delete('friendId')
  return `${url.pathname}${url.search}${url.hash}`
}

export default function FriendFilterBand({ friend, subject, listHref }: {
  friend: { id: string; displayName: string | null; pictureUrl?: string | null }
  subject: string
  listHref: string
}) {
  const name = friend.displayName || '名前未取得の友だち'
  return <Notice tone="info" data-friend-filter={friend.id} icon={null}>
    <div className={styles.row}>
      <Avatar name={name} src={friend.pictureUrl ?? undefined} size={32} />
      <span className={styles.message}>{name}さんの{subject}だけを出しています</span>
      <Button variant="text" href={friendFilterHref(listHref, null)}>全員の{subject}を見る</Button>
      <span className={styles.return}><Button variant="text" href={`/friends/detail?id=${encodeURIComponent(friend.id)}`}>{name}さんの詳細へ戻る</Button></span>
    </div>
  </Notice>
}
