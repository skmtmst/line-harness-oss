'use client'

/*
 * ★V8 友だち追加時の配信 作る 完了（有効にした）（Pencil `e0FD1J`）。
 * 有効にしたあとに出る面。読み直しはしない——有効にしたときの設定名・順番・知らせのつながりをそのまま出す。
 * 頭（戻る・題・手順の輪・説明）は型の PageHeading、真ん中に完了のカードを1枚。
 */
import Link from 'next/link'
import { Activity, Check, Link2, List } from 'lucide-react'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import Stepper from '@/components/shared/stepper'
import Button from '@/components/shared/button'
import { PUBLISH_STEPS } from './flow'
import styles from './publish.module.css'

export default function FriendAddDoneV8({ ruleName, routeNames, priority, slackConnected }: {
  ruleName: string
  routeNames: string[]
  priority: number
  slackConnected: boolean | null
}) {
  return (
    <PageFrame kind="create" boardId="e0FD1J">
      <PageHeading
        title="初回案内を作る"
        identity={<Link href="/friend-add-settings" className={styles.backLink}>← 友だち追加時の配信へ</Link>}
        steps={<Stepper label="初回案内の作る手順" steps={PUBLISH_STEPS.map((label) => ({ label, state: 'done' as const }))} />}
        description={`名前：${ruleName}`}
      />
      <div className={styles.doneBody}>
        <section className={styles.doneCard} aria-label="有効化の完了">
          <span className={styles.doneMark} aria-hidden="true"><Check size={22} /></span>
          <h2 className={styles.doneTitle}>「{ruleName}」を有効にしました</h2>
          <p className={styles.doneDesc}>
            {routeNames.length > 0 ? `${routeNames.join('・')}から` : ''}友だち追加した人に、すぐ案内が届きます。止めたいときは、一覧の「…」から止められます。
          </p>
          <dl className={styles.doneRows}>
            <div className={styles.doneRow}>
              <dt>順番</dt>
              <dd>{priority}番目</dd>
            </div>
            <div className={styles.doneRow}>
              <dt>失敗の知らせ</dt>
              <dd>Slack{slackConnected === true ? '（接続済み）' : slackConnected === false ? '（未接続）' : ''}</dd>
            </div>
          </dl>
          <div className={styles.doneActions}>
            <Button href="/friend-add-settings"><List size={15} aria-hidden="true" />一覧へ戻る</Button>
            <Button href="/inflow-links"><Link2 size={15} aria-hidden="true" />流入リンクを見る</Button>
            <Button href="/friend-add-settings/runs" variant="primary"><Activity size={15} aria-hidden="true" />実行結果を見る</Button>
          </div>
        </section>
      </div>
    </PageFrame>
  )
}
