import { BookOpen, CircleHelp, Info, LifeBuoy, Lock, Save } from 'lucide-react'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Checkbox from '@/components/shared/checkbox'
import { Field } from '@/components/shared/form-controls'
import { SaveErrorField } from '@/components/shared/save-form-errors'
import { TextField } from '@/components/shared/text-field'
import { CreateStepColumns } from '@/components/templates/create-step-columns'
import { LOGIN_ACKS, WEBHOOK_ACKS, developerChannelUrl } from './logic'
import styles from './register.module.css'

/*
 * ★LINE新規追加_v06.pen（2026-10-15承認）②アカウント接続 Fqy29 の描画だけ。
 * register.tsx が行数の関所（apps/web/scripts/v8-guard/code-size.mjs）を越えたので
 * 切り出した。状態は持たず、register.tsx から受け取って出すだけ（見た目は変えていない）。
 */

const MANUAL = '/manuals/line-connect/index.html'

/* 正本 v06 ②の左の細い列「AC左 操作ステップ」（g48QV）。いまどこを触っているかを3段で見せる。 */
const AC_OUTLINE: ReadonlyArray<{ title: string; note: string }> = [
  { title: 'Messaging API の2項目', note: 'LINE Developers からコピー' },
  { title: 'Webhook の設定', note: 'LINE Developers で3つをONに' },
  { title: 'LINEログインの2項目', note: '同じプロバイダーの中に作る' },
]

function AcOutline({ sub }: { sub: number }) {
  return (
    <div className={styles.outlineCard} data-design-node="g48QV">
      <p className={styles.outlineTitle}>操作ステップ</p>
      <p className={styles.outlineCount}>全{AC_OUTLINE.length}ステップ</p>
      <div className={styles.outlineGap} aria-hidden="true" />
      {AC_OUTLINE.map((row, index) => {
        const number = index + 1
        const state = number < sub ? styles.outlineDone : number === sub ? styles.outlineCurrent : styles.outlineFuture
        return (
          <div key={row.title} className={`${styles.outlineRow} ${state}`} aria-current={number === sub ? 'step' : undefined}>
            <span className={styles.outlineNum} aria-hidden="true">{number}</span>
            <div className={styles.outlineText}>
              <p className={styles.outlineRowTitle}>{row.title}</p>
              <p className={styles.outlineRowNote}>{row.note}</p>
            </div>
          </div>
        )
      })}
      <div className={styles.outlineSpacer} aria-hidden="true" />
      <div className={styles.outlineAuto}>
        <p className={styles.outlineAutoTitle}>musubo が自動で行うこと</p>
        <p className={styles.outlineAutoBody}>Webhook URL の登録／アカウント名・@ID・アイコンの取り込み／LIFF（友だち追加）の作成。入力は不要です。</p>
      </div>
    </div>
  )
}

/** ②で入れてもらう4項目。register.tsx の FormState から必要なぶんだけ受け取る。 */
export type Step2Field = 'channelId' | 'channelSecret' | 'loginChannelId' | 'loginChannelSecret'

export default function Step2Connect({
  sub, badge, values, fieldErrors, acks, onUpdate, onToggleAck,
}: {
  /** ②の中の小さな段（1〜3）。 */
  sub: number
  /** 「Step 1 / 3」などの札。 */
  badge: string
  /** いま入っている4項目。 */
  values: Record<Step2Field, string>
  fieldErrors: Record<string, string>
  acks: Record<string, boolean>
  onUpdate: (key: Step2Field, value: string) => void
  onToggleAck: (key: string, next: boolean) => void
}) {
  return (
    /* 正本 v06 ②の右の列（Step1 msf5n／Step2 RtWJZ／Step3 J84XB は同じ中身）。
       白い板の中に、マニュアル → 区切り → 途中保存して閉じる → 区切り → うまくいかないとき → サポートに聞く。 */
    <CreateStepColumns data-design-node="Fqy29" outlineTitle="操作ステップ" outline={<AcOutline sub={sub} />} previewTitle="マニュアル" preview={(
      <Card className={styles.aside} layout="vertical" surface="standard" contentPadding="var(--tpl-htn-aside-pad)" gap="var(--tpl-htn-aside-gap)" aria-label="マニュアル">
        <Button external href={MANUAL} icon={<BookOpen size={16} aria-hidden="true" />}>マニュアルを開く</Button>
        <div className={styles.asideLine} aria-hidden="true" />
        {/* 下書きは入力のたびに端末へ残るので、閉じるだけでよい（行き先は下の「キャンセル」と同じ）。 */}
        <Button href="/hq" icon={<Save size={16} aria-hidden="true" />}>途中保存して閉じる</Button>
        <div className={styles.asideLine} aria-hidden="true" />
        <h2 className={styles.asideH3}>うまくいかないとき</h2>
        <Button href="/hq/support" icon={<LifeBuoy size={16} aria-hidden="true" />}>サポートに聞く</Button>
      </Card>
      )}>
      {sub === 1 && (
        /* 正本 v06 Fqy29 → ②-1（msf5n）の A2cEg1。入力は縦に2つだけで、
           ほかの項目は musubo が自動で設定するので欄も控えも置かない。 */
        <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label="Messaging API の情報を入れる">
          <p className={styles.subBadge}>{badge}</p>
          <div className={styles.precheckHead}>
            <h2 className={styles.panelTitle}>Messaging API の情報を入れる</h2>
            <span className={styles.precheckHelpMark} title="LINE公式アカウントの本体（Messaging API チャネル）とつなぐための情報です。" aria-label="LINE公式アカウントの本体（Messaging API チャネル）とつなぐための情報です。"><CircleHelp size={14} aria-hidden="true" /></span>
          </div>
          <p className={styles.precheckLead}>LINE公式アカウントと musubo をつなぐための2項目です。ほかの項目は musubo が自動で設定するので入力はいりません。</p>
          <div className={`${styles.precheckNote} ${styles.precheckNoteInfo}`}>
            <p className={styles.precheckNoteTitle}>LINE Developers を開いてください</p>
            <p>Messaging API チャネルの「チャネル基本設定」に、チャネルID とチャネルシークレットがあります。</p>
            <div className={styles.precheckNoteLink}>
              <Button variant="primary" external href={developerChannelUrl(values.channelId)}>LINE Developers を開く</Button>
            </div>
          </div>
          <div className={styles.acInputs}>
            <div className={styles.acField}>
              <Field htmlFor="v8-channel-id" label="チャネルID" error={fieldErrors.channelId}>
                <SaveErrorField names={["channelId","form.channelId","channel_id","form.channel_id"]}><TextField id="v8-channel-id" value={values.channelId} onChange={(event) => onUpdate('channelId', event.target.value)} inputMode="numeric" placeholder="例：2001234567" required aria-invalid={fieldErrors.channelId ? true : undefined} /></SaveErrorField>
              </Field>
              <p className={styles.help}>Messaging API チャネルの「チャネル基本設定」にある数字です。</p>
            </div>
            <div className={styles.acField}>
              <Field htmlFor="v8-channel-secret" label="チャネルシークレット" error={fieldErrors.channelSecret}>
                <SaveErrorField names={["channelSecret","form.channelSecret","channel_secret","form.channel_secret"]}><TextField id="v8-channel-secret" type="password" autoComplete="new-password" value={values.channelSecret} onChange={(event) => onUpdate('channelSecret', event.target.value)} placeholder="例：abc123def456ghi789…" required aria-invalid={fieldErrors.channelSecret ? true : undefined} /></SaveErrorField>
              </Field>
              <p className={styles.help}>同じ画面の「チャネルシークレット」です。</p>
            </div>
          </div>
          <span className={styles.secretNote}><Lock size={14} aria-hidden="true" />シークレットは保存したあと画面には出ません。あとから入れ替えはできます。</span>
        </Card>
      )}
      {sub === 2 && (
        /* 正本 v06 Fqy29 → ②-2（f4AgA）の S1KaUa。Webhook URL は musubo が自動で登録するので
           入力欄も控えも置かない。利用者がやるのは LINE Developers の3つのスイッチだけ。 */
        <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label="Webhook（受信のつなぎ）を設定する">
          <p className={styles.subBadge}>{badge}</p>
          <div className={styles.precheckHead}>
            <h2 className={styles.panelTitle}>Webhook（受信のつなぎ）を設定する</h2>
            <span className={styles.precheckHelpMark} title="LINE からのメッセージを musubo が受け取るための通り道です。" aria-label="LINE からのメッセージを musubo が受け取るための通り道です。"><CircleHelp size={14} aria-hidden="true" /></span>
          </div>
          <p className={styles.precheckLead}>Webhook URL（受信先のアドレス）は musubo が自動で登録します。入力は要りません。ここでは LINE Developers の画面にある3つのスイッチだけ、ご自身でONにしてください。</p>
          <div className={`${styles.precheckNote} ${styles.precheckNoteInfo}`}>
            <p className={styles.precheckNoteTitle}>LINE Developers の Webhook 設定を開いてください</p>
            <p>ステップ1で入れたチャネルIDを使って、このチャネルの「Messaging API設定」を直接開きます。プロバイダーやチャネルを選び直す必要はありません。</p>
            <div className={styles.precheckNoteLink}>
              <Button variant="primary" external href={developerChannelUrl(values.channelId)}>LINE Developers を開く</Button>
              <p className={styles.help}>必ずこのボタンから操作してください</p>
            </div>
          </div>
          <div className={`${styles.precheckNote} ${styles.precheckNoteWarn}`}>
            <p className={styles.precheckNoteTitle}>すでにほかのツールのURLが入っているとき</p>
            <p>Webhook URL の欄に別の配信ツールのURLが入っている場合、あとの「接続チェック」で musubo のURLに書きかわり、そのツールの受信は止まります。使い続けたいときは、ここで「途中保存して閉じる」を押して、既存のWebhook URLを別途保存してから進めてください。</p>
          </div>
          <div className={styles.field}>
            <p className={styles.groupLabel}>設定手順の確認</p>
            <p className={styles.help}>「Messaging API設定」の画面でONにしたら、下のチェックを入れてください。</p>
          </div>
          <div className={styles.ackList}>
            {WEBHOOK_ACKS.map((ack) => (
              <div key={ack.key}>
                <SaveErrorField names={[ack.key]}><Checkbox checked={Boolean(acks[ack.key])} onCheckedChange={(next) => onToggleAck(ack.key, next)}>{ack.label}</Checkbox></SaveErrorField>
                <p className={styles.ackNote}>{ack.note}</p>
              </div>
            ))}
          </div>
          <p className={styles.help}>3つすべてにチェックを入れると「次のステップへ」が押せるようになります。</p>
        </Card>
      )}
      {sub === 3 && (
        /* 正本 v06 Fqy29 → ②-3（J84XB）の wI40b。Callback URL は musubo が自動で登録するので
           控えの欄を置かない。開くボタンは、ステップ1のチャネルIDから同じプロバイダーをたどる。 */
        <Card surface="standard" layout="vertical" contentPadding="var(--tpl-htn-panel-pad)" gap="var(--tpl-htn-panel-gap)" className={styles.panel} aria-label="LINEログインの情報を入れる">
          <p className={styles.subBadge}>{badge}</p>
          <div className={styles.precheckHead}>
            <h2 className={styles.panelTitle}>LINEログインの情報を入れる</h2>
            <span className={styles.precheckHelpMark} title="友だち追加の窓口（LIFF）を musubo が自動で作るために使います。" aria-label="友だち追加の窓口（LIFF）を musubo が自動で作るために使います。"><CircleHelp size={14} aria-hidden="true" /></span>
          </div>
          <p className={styles.precheckLead}>友だち追加の窓口（LIFF）を musubo が自動で作るために使います。入れていただくのはこの2項目だけです。</p>
          <div className={`${styles.precheckNote} ${styles.precheckNoteInfo}`}>
            <p className={styles.precheckNoteTitle}>LINE Developers で「LINEログイン」チャネルを開いてください</p>
            <p>ステップ1で入れたチャネルIDから、Messaging API と同じプロバイダーの画面を直接開きます。その中で「LINEログイン」チャネルを作り、下の2項目をコピーしてください。プロバイダーやチャネルを探し直す必要はありません。</p>
            <div className={styles.precheckNoteLink}>
              <Button variant="primary" external href={developerChannelUrl(values.channelId)}>LINE Developers を開く</Button>
              <p className={styles.help}>必ずこのボタンから操作してください</p>
            </div>
          </div>
          <div className={styles.acInputs}>
            <div className={styles.acField}>
              <Field htmlFor="v8-login-channel-id" label="チャネルID（LINEログイン）" error={fieldErrors.loginChannelId}>
                <SaveErrorField names={["loginChannelId","form.loginChannelId","login_channel_id","form.login_channel_id"]}><TextField id="v8-login-channel-id" value={values.loginChannelId} onChange={(event) => onUpdate('loginChannelId', event.target.value)} inputMode="numeric" placeholder="例：2001234567" required aria-invalid={fieldErrors.loginChannelId ? true : undefined} /></SaveErrorField>
              </Field>
              <p className={styles.help}>LINEログインチャネルの「チャネル基本設定」にあります。Messaging API のIDとは違う番号です。</p>
            </div>
            <div className={styles.acField}>
              <Field htmlFor="v8-login-channel-secret" label="チャネルシークレット（LINEログイン）" error={fieldErrors.loginChannelSecret}>
                <SaveErrorField names={["loginChannelSecret","form.loginChannelSecret","login_channel_secret","form.login_channel_secret"]}><TextField id="v8-login-channel-secret" type="password" autoComplete="new-password" value={values.loginChannelSecret} onChange={(event) => onUpdate('loginChannelSecret', event.target.value)} placeholder="例：abc123def456ghi789…" required aria-invalid={fieldErrors.loginChannelSecret ? true : undefined} /></SaveErrorField>
              </Field>
              <p className={styles.help}>同じ画面の「チャネルシークレット」です。</p>
            </div>
          </div>
          <div className={styles.field}>
            <p className={styles.groupLabel}>設定手順の確認</p>
            <p className={styles.help}>「LINEログイン」チャネルの画面で設定したら、下のチェックを入れてください。</p>
          </div>
          <div className={styles.ackList}>
            {LOGIN_ACKS.map((ack) => (
              <div key={ack.key}>
                <SaveErrorField names={[ack.key]}><Checkbox checked={Boolean(acks[ack.key])} onCheckedChange={(next) => onToggleAck(ack.key, next)}>{ack.label}</Checkbox></SaveErrorField>
                <p className={styles.ackNote}>{ack.note}</p>
              </div>
            ))}
          </div>
          <span className={styles.secretNote}><Info size={14} aria-hidden="true" />2つともチェックを入れると「次のステップへ」が押せるようになります。</span>
        </Card>
      )}
    </CreateStepColumns>
  )
}
