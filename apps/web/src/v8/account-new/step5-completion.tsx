import { Activity, CircleCheck, QrCode, Users } from 'lucide-react'
import { type LineAccountConnectData } from '@/lib/api'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import { emptyValue } from '@/components/shared/empty-value'
import { formatNumber as polishFormatNumber } from '@/lib/format'
import type { HandoverProgress } from './check-rows'
import styles from './register.module.css'

/** 登録完了と友だちの引き継ぎ。保存処理は親が持つ。 */
export default function Step5Completion({ connection, accountName, createdId, importRunning, importFriends, handover, remainText, restaurant }: {
  connection: LineAccountConnectData; accountName: string; createdId: string; importRunning: boolean; importFriends: boolean
  handover: HandoverProgress; remainText: string; restaurant: boolean
}) {
  return (
            <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label={importRunning ? 'いまの友だちを引き継いでいます' : '登録完了'} data-design-node="Plmq1">
              {importRunning && importFriends ? <>
                <h2 className={styles.panelTitle}>いまの友だちを引き継いでいます</h2>
                <Card className={styles.handoverBox} layout="vertical" surface="muted" corner="control" contentPadding="var(--tpl-htn-note-pad)" gap="var(--tpl-htn-gap-xs)">
                  <div className={styles.handoverStats}>
                    <strong>{`${polishFormatNumber(handover.imported)} 人`}</strong>
                    <strong>{handover.total !== null ? `${polishFormatNumber(handover.total)} 人` : '確認中'}</strong>
                  </div>
                  <div className={styles.progressTrack} role="progressbar" aria-valuenow={handover.rate} aria-valuemin={0} aria-valuemax={100} aria-label="友だちの引き継ぎ">
                    <span className={styles.progressFill} style={{ width: `${handover.rate}%` }} />
                  </div>
                  <p className={styles.progressNote}>{remainText}</p>
                  <p className={styles.progressWarn}>引き継ぎは画面を閉じても続きます。もう一度開くと進み具合を確認できます。</p>
                </Card>
              </> : <>
                <div className={styles.doneHero}>
                  <CircleCheck size={28} className={styles.doneIcon} aria-hidden="true" />
                  <p className={styles.doneTitle}>準備ができました</p>
                </div>
                <Card className={styles.accountBox} layout="vertical" surface="muted" corner="control" contentPadding="var(--tpl-htn-note-pad)" gap="var(--tpl-htn-gap-xs)">
                  <span className={styles.accountName}>{(connection.displayName ?? accountName) || 'LINEアカウント'}</span>
                  <span className={styles.accountId}>{connection.basicId || String(emptyValue('none'))}</span>
                </Card>
                <Card layout="vertical" surface="muted" corner="control" contentPadding="var(--tpl-htn-note-pad)" gap="var(--tpl-htn-gap-xs)">
                  {importFriends
                    ? <p className={styles.progressNote}>{`いまの友だちを ${polishFormatNumber(handover.imported)} 人 引き継ぎました。`}</p>
                    : <p className={styles.progressNote}>いまの友だちの引き継ぎはオフになっています。引き継ぐときはアカウントの詳細から始めてください。</p>}
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
                  {restaurant ? <Button href="/restaurant-test/stores/new">飲食店の店舗を追加する</Button> : null}
                  <Button href="/friends"><Users size={15} aria-hidden="true" />友だち一覧</Button>
                  <Button href="/friend-add-settings"><QrCode size={15} aria-hidden="true" />友だち追加URL・QR</Button>
                  <Button href="/emergency"><Activity size={15} aria-hidden="true" />運用状態の接続監視</Button>
                </div>
              </>}
            </Card>
  )
}
