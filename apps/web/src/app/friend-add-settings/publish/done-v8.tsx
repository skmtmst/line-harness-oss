'use client'

/*
 * ★V8 友だち追加時の配信の有効化の完了（板 `e0FD1J`）。
 * 作る⑤の「有効にする」のあとに出る面。読み直しはしない——公開した
 * ときの数（設定名・順番・知らせのつながり）をそのまま出す。
 */
import Link from 'next/link'
import { Activity, Check, Link2, List } from 'lucide-react'
import Button from '@/components/shared/button'
import styles from './done-v8.module.css'

const DONE_STEPS = ['基本設定', '流入リンク', '初回案内', 'あわせて行うこと', '確認']

export default function FriendAddDoneV8({ ruleName, routeNames, priority, slackConnected }: {
  ruleName: string
  routeNames: string[]
  priority: number
  slackConnected: boolean | null
}) {
  return (
    <div className={styles.board} data-design-node="e0FD1J">
      <Link className={styles.backLink} href="/friend-add-settings">← 友だち追加時の配信へ</Link>
      <h2 className={styles.title}>初回案内を作る</h2>
      <nav className={styles.steps} aria-label="初回案内の作る手順">
        {DONE_STEPS.map((label, index) => (
          <span key={label} className={styles.stepWrap}>
            <span className={styles.stepDone}>
              <span className={styles.stepMark}>
                <Check size={13} aria-hidden="true" />
              </span>
              {label}
            </span>
            {index < DONE_STEPS.length - 1 ? <span className={styles.stepLine} aria-hidden="true" /> : null}
          </span>
        ))}
      </nav>
      <p className={styles.stepNote}>名前：{ruleName}</p>
      <div className={styles.center}>
        <section className={styles.card} aria-label="有効化の完了">
          <span className={styles.doneMark} aria-hidden="true">
            <Check size={22} />
          </span>
          <h3 className={styles.doneTitle}>「{ruleName}」を有効にしました</h3>
          <p className={styles.doneDesc}>
            {routeNames.length > 0 ? `${routeNames.join('・')}から` : ''}友だち追加した人に、すぐ案内が届きます。止めたいときは、一覧の「…」から止められます。
          </p>
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt>順番</dt>
              <dd>{priority}番目</dd>
            </div>
            <div className={styles.row}>
              <dt>失敗の知らせ</dt>
              <dd>Slack{slackConnected === true ? '（接続済み）' : slackConnected === false ? '（未接続）' : ''}</dd>
            </div>
          </dl>
          <div className={styles.actions}>
            <Button href="/friend-add-settings" variant="secondary">
              <List size={14} aria-hidden="true" />
              一覧へ戻る
            </Button>
            <Button href="/inflow-links" variant="secondary">
              <Link2 size={14} aria-hidden="true" />
              流入リンクを見る
            </Button>
            <Button href="/friend-add-settings/runs" variant="primary">
              <Activity size={14} aria-hidden="true" />
              実行結果を見る
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
