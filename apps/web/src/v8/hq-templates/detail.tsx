'use client'

/*
 * ★V8 統括のテンプレートの詳細（絵 V8.pen pQ4fH・B-36）。
 *
 * 店のテンプレートの詳細（src/v8/template-detail）と同じ枠（DetailFrame）・同じ CSS・同じ並び（本文・右の列の操作・
 * このテンプレートについて・届き方）で組む。違いは「使っている所」の代わりの「配った先」（API-14 の配った先の
 * アカウント名・中身の要約）と、帯の［アカウントへ配る］。
 * 読み書き（読み込み・複製・配る）は呼ぶ側（console.tsx）。ここは見せ方と押した知らせだけ。
 */
import { ArrowLeft, CircleAlert, Copy, LogIn, Pencil, Send } from 'lucide-react'
import type { MessageTemplateDefinition } from '@line-crm/shared'
import { templateKind } from '@line-crm/shared'
import Button from '@/components/shared/button'
import LinePreview from '@/components/shared/line-preview'
import { DetailFrame } from '@/v8/template-detail/detail'
import type { HqAccount, HqTemplateListItem, TemplateDetail } from '@/lib/hq-templates-api'
import { KIND_TABS } from './store-list'
import styles from '../template-detail/detail.module.css'

/** 「8月21日 18:02」。 */
function stamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
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

export default function HqTemplateDetail({
  detail, row, accounts, folderName, canEdit, busy, notices, onBack, onEdit, onDistribute, onDuplicate, onEnterAccount,
}: {
  detail: TemplateDetail
  /** 一覧の行（API-14 の配った先のアカウント名・数・中身の要約）。一覧に無いときは「—」。 */
  row?: HqTemplateListItem
  accounts: HqAccount[]
  folderName: string
  canEdit: boolean
  busy: boolean
  notices?: React.ReactNode
  onBack: () => void
  onEdit: () => void
  onDistribute: () => void
  onDuplicate: () => void
  /** 配った先のアカウントに入る（店の画面へ切り替える）。 */
  onEnterAccount: (accountId: string) => void
}) {
  const definition = detail.definition as MessageTemplateDefinition
  const kind = 'template' in definition ? templateKind(definition) : 'message'
  const kindLabel = KIND_TABS.find((tab) => tab.kind === kind)?.label ?? 'メッセージ'
  const content = 'template' in definition ? definition.template.messageContent : ''
  const summary = row?.content_summary ?? null
  const distributedNames = row?.distributed_account_names ?? []
  const distributedCount = row?.distributed_account_count ?? 0
  const more = row?.distributed_account_more ?? 0
  const words = insertions(content)
  const text = kind === 'message' && content.trim() ? content : summary ? `［${kindLabel}］${summary}` : `［${kindLabel}］`

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
          <div className={styles.aboutRow}><dt>配った先</dt><dd>{distributedCount > 0 ? `${distributedCount} アカウント` : 'まだ配っていない'}</dd></div>
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

  return (
    <div className={styles.page} data-design-node="pQ4fH">
      <DetailFrame
        title={detail.template.name}
        identity={backLink}
        description={[kindLabel, folderName, `版 ${detail.template.revision}`, `更新 ${stamp(detail.template.updated_at)}`].join('・')}
        preview={side}
      >
        {canEdit ? null : <p className={styles.roBand} role="note">閲覧のみで見ています。編集・配る操作は管理者に頼んでください。</p>}
        {notices}
        {canEdit ? (
          <div className={styles.draftBand} role="status">
            <CircleAlert size={18} aria-hidden="true" className={styles.draftIcon} />
            <div className={styles.draftText}>
              <p className={styles.draftTitle}>{distributedCount > 0 ? '直したら、配ると新しい版になります' : 'まだ配っていません'}</p>
              <p className={styles.draftNote}>
                {distributedCount > 0
                  ? `配ると、配った ${distributedCount} アカウントのテンプレートが新しい版になります（各アカウントで使っている所はそのアカウントの決まりで切り替わります）`
                  : '「アカウントへ配る」で、選んだアカウントのテンプレートに届きます'}
              </p>
            </div>
            <Button variant="primary" onClick={onDistribute} disabled={busy}>
              <Send size={14} aria-hidden="true" />
              アカウントへ配る
            </Button>
          </div>
        ) : null}

        <section className={styles.card} aria-label="本文">
          <div className={styles.cardHead}>
            <div className={styles.cardTitles}>
              <h2 className={styles.cardTitle}>{kind === 'message' ? '本文' : '中身'}</h2>
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
          {distributedNames.length > 0 ? (
            <>
              {distributedNames.map((name) => {
                const accountId = accountIdOf(name)
                return (
                  <div key={name} className={styles.usageRow}>
                    <span className={styles.usageKind} title={name}>{shortName(name)}</span>
                    <span className={styles.usageNameQuiet} title={name}>{name}</span>
                    <span className={styles.usageVersion}>—</span>
                    <span className={styles.usageState}>受け取り済み</span>
                    {accountId ? (
                      <button type="button" className={styles.ghostButton} onClick={() => onEnterAccount(accountId)}><LogIn size={14} aria-hidden="true" />このアカウントへ入る</button>
                    ) : <span className={styles.ghostSpacer} aria-hidden="true" />}
                  </div>
                )
              })}
              {more > 0 ? <div className={styles.moreRow}><span className={styles.empty}>{`ほか ${more} アカウント`}</span></div> : null}
            </>
          ) : <p className={styles.empty}>まだ配っていません</p>}
          {canEdit ? (
            <div className={styles.moreRow}>
              <button type="button" className={styles.ghostButton} onClick={onDistribute} disabled={busy}>配る先を変える</button>
            </div>
          ) : null}
        </section>
      </DetailFrame>
    </div>
  )
}
