'use client'

/*
 * ★V8 統括のテンプレートの詳細（絵 V8.pen pQ4fH・B-36）。
 *
 * 店のテンプレートの詳細（src/v8/template-detail）と同じ枠（DetailFrame）・同じ CSS・同じ並び（本文・配った先・版の履歴・
 * 右の列の操作・このテンプレートについて・届き方）で組む。違いは「使っている所」の代わりの「配った先」と、帯の［アカウントへ配る］。
 * 配った先ごとの版（版3（いまの版）／新しい版を未配布）・版の履歴（比べる・この版に戻す）・今月送った数は API-18。
 * 読み書き（読み込み・複製・配る・版を比べる・戻す）は呼ぶ側（console.tsx）。ここは見せ方と押した知らせだけ。
 */
import { useState } from 'react'
import { ArrowLeft, CircleAlert, Copy, GitCompare, LogIn, Pencil, RotateCcw, Send } from 'lucide-react'
import type { HqTemplateReceivedVersion, HqTemplateVersionComparison, HqTemplateVersionDisplay, MessageTemplateDefinition } from '@line-crm/shared'
import { templateKind } from '@line-crm/shared'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import LinePreview from '@/components/shared/line-preview'
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import { ChangeBox, DetailFrame } from '@/v8/template-detail/detail'
import type { HqAccount, HqTemplateListItem, TemplateDetail } from '@/lib/hq-templates-api'
import { KIND_TABS, sentLabel } from './store-list'
import styles from '../template-detail/detail.module.css'

/** 「8月21日 18:02」（日本時間）。 */
function stamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return `${j.getUTCMonth() + 1}月${j.getUTCDate()}日 ${j.getUTCHours()}:${String(j.getUTCMinutes()).padStart(2, '0')}`
}

/** 本文の差し込み（{{name}} など）の名前。 */
function insertions(content: string): string[] {
  const names = new Set<string>()
  for (const match of content.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    const key = match[1]
    names.add(key === 'name' ? '名前' : key.startsWith('date') ? '配信日' : key.startsWith('field.') ? '友だち情報' : key.startsWith('var.') ? '共通情報' : 'その他')
  }
  return [...names]
}

/** 版を比べるときの文（メッセージは本文、ほかの形は中身を行に分けた文）。 */
export function definitionText(definition: unknown): string {
  if (definition && typeof definition === 'object' && 'template' in definition) {
    const message = definition as MessageTemplateDefinition
    if (message.asset) return JSON.stringify(message.asset.payload, null, 1)
    if (message.template.questionJson) return message.template.questionJson
    return message.template.messageContent
  }
  return JSON.stringify(definition, null, 1)
}

/** いま配った先が使っている版（配布に成功した版のうち一番新しいもの）。 */
export function inUseVersionOf(versions: readonly HqTemplateVersionDisplay[] | null): HqTemplateVersionDisplay | null {
  return [...(versions ?? [])].filter((version) => !version.is_draft).sort((a, b) => b.version - a.version)[0] ?? null
}

/** 配った先の1行の版と状態（API-18 の received-versions）。 */
export function receivedLabels(row: HqTemplateReceivedVersion): { version: string; state: string } {
  const target = row.targetVersion
  if (target.status === 'undistributed' || target.version == null) return { version: '—', state: 'まだ配っていない' }
  return target.status === 'latest'
    ? { version: `版${target.version}（いまの版）`, state: '受け取り済み' }
    : { version: `版${target.version}`, state: '新しい版を未配布' }
}

export default function HqTemplateDetail({
  detail, row, accounts, folderName, canEdit, busy, notices, versions, versionsError, received, onReloadVersions, onCompare, onRestore,
  onBack, onEdit, onDistribute, onDuplicate, onEnterAccount,
}: {
  detail: TemplateDetail
  /** 一覧の行（配った先のアカウント名・数・中身の要約・今月送った数）。一覧に無いときは「—」。 */
  row?: HqTemplateListItem
  accounts: HqAccount[]
  folderName: string
  canEdit: boolean
  busy: boolean
  notices?: React.ReactNode
  /** 版の履歴（API-18）。null は読み込み中。 */
  versions: HqTemplateVersionDisplay[] | null
  versionsError: boolean
  /** 配った先ごとの版（API-18）。null は読み込み中か読めなかった（その時は一覧の名前で出す）。 */
  received: HqTemplateReceivedVersion[] | null
  onReloadVersions: () => void
  onCompare: (from: number, to: number) => Promise<HqTemplateVersionComparison>
  onRestore: (version: number) => Promise<void>
  onBack: () => void
  onEdit: () => void
  onDistribute: () => void
  onDuplicate: () => void
  /** 配った先のアカウントに入る（店の画面へ切り替える）。 */
  onEnterAccount: (accountId: string) => void
}) {
  const [compare, setCompare] = useState<{ from: number; to: number; result: HqTemplateVersionComparison | null; error: string } | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<number | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState('')

  const definition = detail.definition as MessageTemplateDefinition
  const kind = 'template' in definition ? templateKind(definition) : 'message'
  const kindLabel = KIND_TABS.find((tab) => tab.kind === kind)?.label ?? 'メッセージ'
  const content = 'template' in definition ? definition.template.messageContent : ''
  const summary = row?.content_summary ?? null
  const distributedNames = row?.distributed_account_names ?? []
  const distributedCount = row?.distributed_account_count ?? received?.filter((item) => item.targetVersion.status !== 'undistributed').length ?? 0
  const more = row?.distributed_account_more ?? 0
  const words = insertions(content)
  const text = kind === 'message' && content.trim() ? content : summary ? `［${kindLabel}］${summary}` : `［${kindLabel}］`
  const current = versions?.find((version) => version.is_current) ?? null
  const inUse = inUseVersionOf(versions)
  /* 直したあと配っていない：いまの版がまだどこにも配られていない（配った先はある）か、古い版のままの先がある。 */
  const outdatedCount = row?.outdated_account_count ?? received?.filter((item) => item.targetVersion.status === 'older').length ?? 0
  const unsentChanges = distributedCount > 0 && (outdatedCount > 0 || Boolean(current?.is_draft))
  const receivedRows = (received ?? []).filter((item) => item.targetVersion.status !== 'undistributed')

  const openCompare = (from: number, to: number) => {
    if (compare && compare.from === from && compare.to === to) { setCompare(null); return }
    setCompare({ from, to, result: null, error: '' })
    void onCompare(from, to).then(
      (result) => setCompare((now) => (now && now.from === from && now.to === to ? { ...now, result } : now)),
      (caught) => setCompare((now) => (now && now.from === from && now.to === to ? { ...now, error: japaneseDetailOf(caught) || '版を比べられませんでした。もう一度お試しください。' } : now)),
    )
  }
  const compareBox = compare ? (
    compare.error ? <p className={styles.errorText} role="alert">{compare.error}</p>
      : !compare.result ? <p className={styles.empty} role="status">比べています…</p>
      : (
        <ChangeBox
          title={`比べる（版${compare.from} → 版${compare.to}）`}
          before={definitionText(compare.result.from.definition)}
          after={definitionText(compare.result.to.definition)}
        />
      )
  ) : null

  const side = (
    <div className={styles.side}>
      {canEdit ? (
        <div className={styles.sideActions}>
          <Button variant="secondary" href="/hq/broadcasts/new">
            <Send size={14} aria-hidden="true" />
            一括配信で使う
          </Button>
          <Button variant="secondary" onClick={onDuplicate} disabled={busy}>
            <Copy size={14} aria-hidden="true" />
            複製する
          </Button>
        </div>
      ) : null}
      <section className={styles.aboutBox} aria-label="このテンプレートについて">
        <h2 className={styles.aboutTitle}>このテンプレートについて</h2>
        <dl className={styles.aboutList}>
          <div className={styles.aboutRow}><dt>種類</dt><dd>{kindLabel}</dd></div>
          <div className={styles.aboutRow}><dt>フォルダ</dt><dd>{folderName}</dd></div>
          <div className={styles.aboutRow}><dt>今月送った数</dt><dd title={row?.this_month_sent_count == null ? '今月送った数は、この種類では数えていません' : '配った先の合計'}>{sentLabel(row?.this_month_sent_count)}</dd></div>
          <div className={styles.aboutRow}><dt>差し込み</dt><dd title={words.join('・')}>{words.length > 0 ? words.join('・') : 'なし'}</dd></div>
        </dl>
      </section>
      <LinePreview accountName="公式アカウント" note="受け取る人のLINEでの見え方です。{ } の差し込みは、配った先のアカウントで送るときに、受け取る人ごとの値に変わります。">
        <div className={styles.talkRow}>
          <span className={styles.talkIcon} aria-hidden="true">公</span>
          <div className={styles.talkCol}>
            <span className={styles.talkName}>公式アカウント</span>
            <div className={styles.talkBubbleRow}>
              <p className={styles.talkBubble}>{text}</p>
              <span className={styles.talkTime}>18:00</span>
            </div>
          </div>
        </div>
      </LinePreview>
    </div>
  )

  const backLink = <button type="button" className={styles.backLink} onClick={onBack}><ArrowLeft size={14} aria-hidden="true" />テンプレートへ</button>
  /* 配った先の名前（API-14 はアカウントの今の表示名）からアカウントを引く。同じ名前が無ければ、末尾が一致する1件だけ。 */
  const accountIdOf = (name: string) => {
    const exact = accounts.find((account) => account.name === name)
    if (exact) return exact.id
    const tail = accounts.filter((account) => account.name.endsWith(name))
    return tail.length === 1 ? tail[0].id : null
  }
  const shortName = (name: string) => name.replace(/^然\s*-NEN-\s*/, '')
  const enterButton = (accountId: string | null) => accountId
    ? <button type="button" className={styles.ghostButton} onClick={() => onEnterAccount(accountId)} aria-label="このアカウントへ入る"><LogIn size={14} aria-hidden="true" />入る</button>
    : <span className={styles.ghostSpacer} aria-hidden="true" />
  const creator = (version: HqTemplateVersionDisplay) => `${version.creator_name ?? '—'}・${stamp(version.created_at)}`
  const sortedVersions = [...(versions ?? [])].sort((a, b) => b.version - a.version)

  const restore = async () => {
    if (restoreTarget === null || restoring) return
    setRestoring(true)
    setRestoreError('')
    try {
      await onRestore(restoreTarget)
      setRestoreTarget(null)
      setCompare(null)
    } catch (caught) {
      setRestoreError(japaneseDetailOf(caught) || 'この版に戻せませんでした。もう一度お試しください。')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className={styles.page} data-design-node="pQ4fH">
      <DetailFrame
        title={detail.template.name}
        identity={backLink}
        description={[kindLabel, folderName, current?.creator_name ? `作った人 ${current.creator_name}` : null, `更新 ${stamp(detail.template.updated_at)}`].filter(Boolean).join('・')}
        preview={side}
      >
        {canEdit ? null : <p className={styles.roBand} role="note">閲覧のみで見ています。編集・配る操作は管理者に頼んでください。</p>}
        {notices}
        {canEdit ? (
          <div className={styles.draftBand} role="status">
            <CircleAlert size={18} aria-hidden="true" className={styles.draftIcon} />
            <div className={styles.draftText}>
              <p className={styles.draftTitle}>{unsentChanges ? '配っていない変更があります' : distributedCount > 0 ? '直したら、配ると新しい版になります' : 'まだ配っていません'}</p>
              <p className={styles.draftNote}>
                {distributedCount > 0
                  ? `配ると、配った ${distributedCount} アカウントのテンプレートが新しい版になります（各アカウントで使っている所はそのアカウントの決まりで切り替わります）`
                  : '「アカウントへ配る」で、選んだアカウントのテンプレートに届きます'}
              </p>
            </div>
            {unsentChanges && inUse && current && inUse.version !== current.version ? (
              <Button variant="secondary" onClick={() => openCompare(inUse.version, current.version)} aria-pressed={compare?.from === inUse.version && compare.to === current.version}>
                <GitCompare size={14} aria-hidden="true" />
                比べる
              </Button>
            ) : null}
            <Button variant="primary" onClick={onDistribute} disabled={busy}>
              <Send size={14} aria-hidden="true" />
              アカウントへ配る
            </Button>
          </div>
        ) : null}
        {compare && inUse && current && compare.from === inUse.version && compare.to === current.version ? compareBox : null}

        <section className={styles.card} aria-label="本文">
          <div className={styles.cardHead}>
            <div className={styles.cardTitles}>
              <h2 className={styles.cardTitle}>{`${kind === 'message' ? '本文' : '中身'}${current?.is_draft && distributedCount > 0 ? '（下書き）' : ''}`}</h2>
              <p className={styles.cardNote}>{kind === 'message' ? '{ } は差し込み。受け取る人ごとに変わります。' : summary ?? '中身の要約を読めませんでした'}</p>
            </div>
            {canEdit ? (
              <Button variant="secondary" onClick={onEdit} disabled={busy}>
                <Pencil size={14} aria-hidden="true" />
                編集する
              </Button>
            ) : null}
          </div>
          <div className={styles.bodyBox}>{kind === 'message' ? content : `［${kindLabel}］${summary ?? ''}`}</div>
        </section>

        <section className={styles.card} aria-label="配った先">
          <div className={styles.cardTitles}>
            <h2 className={styles.cardTitle}>配った先</h2>
            <p className={styles.cardNote}>
              {distributedCount > 0
                ? `${distributedCount} アカウントに配りました。新しい版を配ると、${distributedCount} アカウントのテンプレートが新しい版になります。`
                : 'まだどのアカウントにも配っていません。配ると、ここに並びます。'}
            </p>
          </div>
          {receivedRows.length > 0 ? receivedRows.map((item) => {
            const labels = receivedLabels(item)
            return (
              <div key={item.accountId} className={styles.usageRow}>
                <span className={styles.usageKind} title={item.accountName}>{shortName(item.accountName)}</span>
                <span className={styles.usageNameQuiet} title={item.accountName}>{item.accountName}</span>
                <span className={styles.usageVersion} title={labels.version}>{labels.version}</span>
                <span className={styles.usageState}>{labels.state}</span>
                {enterButton(accounts.some((account) => account.id === item.accountId) ? item.accountId : null)}
              </div>
            )
          }) : distributedNames.length > 0 ? (
            <>
              {distributedNames.map((name) => (
                <div key={name} className={styles.usageRow}>
                  <span className={styles.usageKind} title={name}>{shortName(name)}</span>
                  <span className={styles.usageNameQuiet} title={name}>{name}</span>
                  <span className={styles.usageVersion}>—</span>
                  <span className={styles.usageState}>受け取り済み</span>
                  {enterButton(accountIdOf(name))}
                </div>
              ))}
              {more > 0 ? <div className={styles.moreRow}><span className={styles.empty}>{`ほか ${more} アカウント`}</span></div> : null}
            </>
          ) : <p className={styles.empty}>まだ配っていません</p>}
          {canEdit ? (
            <div className={styles.moreRow}>
              <button type="button" className={styles.ghostButton} onClick={onDistribute} disabled={busy}>配る先を変える</button>
            </div>
          ) : null}
        </section>

        <section className={styles.card} aria-label="版の履歴">
          <div className={styles.cardTitles}>
            <h2 className={styles.cardTitle}>版の履歴</h2>
            <p className={styles.cardNote}>戻すと、その版を下書きとして作り直します。配るまで配った先は変わりません</p>
          </div>
          {versions === null && !versionsError ? <p className={styles.empty} role="status">読み込み中…</p> : versionsError ? (
            <div className={styles.versionError}>
              <p className={styles.errorText}>版の履歴を読み込めませんでした。もう一度お試しください。</p>
              <Button variant="secondary" onClick={onReloadVersions}>もう一度読み込む</Button>
            </div>
          ) : (
            <>
              {sortedVersions.map((version) => {
                const isInUse = inUse?.version === version.version
                const label = version.is_current
                  ? (version.is_draft ? '下書き（まだ配っていない）' : 'いまの版')
                  : isInUse ? 'いま使っている版' : version.is_draft ? '配っていない版' : '前の版'
                return (
                  <div key={version.id} className={version.is_current && version.is_draft ? styles.versionDraft : isInUse ? styles.versionInUse : styles.versionPast}>
                    <span className={styles.versionNum}>{`版${version.version}`}</span>
                    <div className={styles.versionText}>
                      <p className={styles.versionLabel}>{label}</p>
                      <p className={styles.versionMeta}>{creator(version)}</p>
                    </div>
                    {version.is_current ? (
                      inUse && inUse.version !== version.version ? (
                        <div className={styles.versionActions}>
                          <Button variant="secondary" onClick={() => openCompare(inUse.version, version.version)}>いまの版と比べる</Button>
                        </div>
                      ) : null
                    ) : !isInUse ? (
                      <div className={styles.versionActions}>
                        {current ? <Button variant="secondary" onClick={() => openCompare(version.version, current.version)}>比べる</Button> : null}
                        {canEdit ? (
                          <Button variant="secondary" disabled={busy} onClick={() => { setRestoreError(''); setRestoreTarget(version.version) }}><RotateCcw size={14} aria-hidden="true" />この版に戻す</Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {compare && !(inUse && current && compare.from === inUse.version && compare.to === current.version) ? compareBox : null}
            </>
          )}
        </section>
      </DetailFrame>

      <ConfirmDialog
        open={restoreTarget !== null}
        title={`版${restoreTarget ?? ''}の内容で下書きを作り直しますか？`}
        description="過去の版は変わりません。その中身で新しい版を作ります。配るまで、配った先のアカウントは今の版のままです。"
        confirmLabel="この版に戻す"
        busy={restoring}
        error={restoreError || undefined}
        onConfirm={() => void restore()}
        onCancel={() => {
          if (restoring) return
          setRestoreTarget(null)
          setRestoreError('')
        }}
      />
    </div>
  )
}
