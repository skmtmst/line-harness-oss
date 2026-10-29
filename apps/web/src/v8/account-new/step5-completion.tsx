import { Activity, CircleCheck, CircleDashed, QrCode, Users } from 'lucide-react'
import { ProgressBar } from '@/components/shared/progress'
import { type FollowerImportState, type LineAccountConnectData } from '@/lib/api'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import { emptyValue } from '@/components/shared/empty-value'
import { formatNumber as polishFormatNumber } from '@/lib/format'
import type { HandoverProgress } from './check-rows'
import styles from './register.module.css'

/** 登録完了と友だちの引き継ぎ。保存処理は親が持つ。 */
export default function Step5Completion({ connection, accountName, createdId, importRunning, importFriends, importState, handover, idleSeconds, requestError, refreshing, onRefresh, restaurant }: {
  connection: LineAccountConnectData; accountName: string; createdId: string; importRunning: boolean; importFriends: boolean
  importState: FollowerImportState | null; handover: HandoverProgress; idleSeconds: number; requestError: boolean
  refreshing: boolean; onRefresh: () => void; restaurant: boolean
}) {
  const checking = Boolean(importState?.lastError) || requestError || idleSeconds >= 60
  const stageLabel = handover.stage === 1 ? 'LINEの友だちを確認中' : '友だち情報を反映中'
  const countLabel = handover.confirmed === null
    ? `LINEで確認できた友だち ${polishFormatNumber(handover.foundSoFar)}人・全体の人数を確認中`
    : `LINEで確認できた友だち ${polishFormatNumber(handover.confirmed)}人`
  return (
            <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label={importRunning ? 'いまの友だちを引き継いでいます' : '登録完了'} data-design-node="Plmq1">
              {importRunning && importFriends ? <>
                <div className={styles.handoverHeading}>
                  <div>
                    <h2 className={styles.panelTitle}>いまの友だちを引き継いでいます</h2>
                    <p className={styles.progressNote}>LINEの友だちを確認し、musuboへ順に反映しています。</p>
                  </div>
                  <StatusBadge tone={checking ? 'caution' : 'warning'}>{checking ? '更新を確認中' : '引き継ぎ中'}</StatusBadge>
                </div>
                <Card className={styles.handoverBox} layout="vertical" surface="muted" corner="control" contentPadding="var(--tpl-htn-note-pad)" gap="var(--tpl-htn-gap-xs)">
                  <div className={styles.handoverCurrent} role="status" aria-live="polite">
                    <CircleDashed className={styles.handoverSpinner} size={20} aria-hidden="true" />
                    <strong>{stageLabel}</strong>
                  </div>
                  <ProgressBar appearance="onboarding" max={3} value={handover.stage} label="友だち引き継ぎの段階" />
                  <div className={styles.handoverStages} aria-hidden="true"><span>友だちを確認</span><span>情報を反映</span><span>完了</span></div>
                  <p className={styles.handoverCount} aria-live="polite">{countLabel}</p>
                  <div className={styles.handoverBreakdown}>
                    <span>新しく取り込んだ友だち <strong>{polishFormatNumber(handover.imported)}人</strong></span>
                    <span>登録済み <strong>{polishFormatNumber(handover.alreadyPresent)}人</strong></span>
                    {handover.restored > 0 ? <span>再登録 <strong>{polishFormatNumber(handover.restored)}人</strong></span> : null}
                    {handover.stage === 2 ? <span>情報を反映 <strong>{polishFormatNumber(handover.profilesUpdated)}人</strong></span> : null}
                  </div>
                  {handover.needsReview > 0 ? <Notice tone="warn" compact>{polishFormatNumber(handover.needsReview)}件は取り込めず、確認が必要です。</Notice> : null}
                  {checking ? <Notice tone="warn" compact>{importState?.lastError || (requestError ? '状態を更新できません。自動で再試行しています。' : '進み具合に変化がありません。状態を読み直して確認できます。')}</Notice> : null}
                  <div className={styles.handoverFooter}>
                    <p className={styles.progressNote}>進み具合は保存されます。この画面で自動的に再試行します。{importState?.updatedAt ? `最終更新 ${importState.updatedAt}` : ''}</p>
                    <Button type="button" variant="secondary" size="compact" busy={refreshing} busyLabel="確認中…" onClick={onRefresh}>進み具合を再確認</Button>
                  </div>
                </Card>
              </> : <>
                <div className={styles.doneHero}>
                  <CircleCheck size={40} className={styles.doneIcon} aria-hidden="true" />
                  <p className={styles.doneTitle}>準備ができました</p>
                </div>
                <Card className={styles.accountBox} layout="vertical" surface="muted" corner="control" contentPadding="var(--tpl-htn-note-pad)" gap="var(--tpl-htn-gap-xs)">
                  <span className={styles.accountName}>{(connection.displayName ?? accountName) || 'LINEアカウント'}</span>
                  <span className={styles.accountId}>{connection.basicId || String(emptyValue('none'))}</span>
                </Card>
                <Card layout="vertical" surface="muted" corner="control" contentPadding="var(--tpl-htn-note-pad)" gap="var(--tpl-htn-gap-xs)">
                  {importFriends
                    ? <p className={styles.progressNote}>{`LINEで確認した ${polishFormatNumber(handover.confirmed ?? handover.foundSoFar)} 人のうち、新しく ${polishFormatNumber(handover.imported)} 人を取り込みました。登録済み ${polishFormatNumber(handover.alreadyPresent)} 人、再登録 ${polishFormatNumber(handover.restored)} 人です。`}</p>
                    : <p className={styles.progressNote}>いまの友だちの引き継ぎはオフになっています。引き継ぐときはアカウントの詳細から始めてください。</p>}
                  {handover.needsReview > 0 ? <Notice tone="warn" compact>{polishFormatNumber(handover.needsReview)}件は取り込めず、確認が必要です。</Notice> : null}
                  {importState && importState.profileErrors > 0 ? <Notice tone="warn" compact>一部のプロフィールは取得できませんでした。友だち一覧で確認してください。</Notice> : null}
                  <p className={styles.progressNote}>LINE の都合で引き継げないアカウントでは、友だちが話しかけた順に登録されます。</p>
                </Card>
                {connection.remainingActions.length > 0 && (
                  <Card className={styles.noteBox} layout="vertical" surface="muted" corner="control" contentPadding="var(--tpl-htn-note-pad)" gap="var(--tpl-htn-gap-s)">
                    <p><strong>残りの手作業</strong></p>
                    <ul>{connection.remainingActions.map((item) => <li key={item}>{item}</li>)}</ul>
                  </Card>
                )}
                <p className={styles.groupLabel}>次にすること</p>
                <div className={styles.buttonRow}>
                  <Button external href={`/accounts/detail?id=${encodeURIComponent(createdId)}`}>登録したアカウントを見る</Button>
                  {restaurant ? <Button href="/restaurant-test/stores/new">飲食店の店舗を作る</Button> : null}
                  <Button href="/friends"><Users size={16} aria-hidden="true" />友だち一覧</Button>
                  <Button href="/friend-add-settings"><QrCode size={16} aria-hidden="true" />友だち追加URL・QR</Button>
                  <Button href="/emergency"><Activity size={16} aria-hidden="true" />運用状態の接続監視</Button>
                </div>
              </>}
            </Card>
  )
}
