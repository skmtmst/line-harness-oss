'use client'

/*
 * ★V8 イベント予約「変更の確認」（Pencil `hmr2P`、確かめる窓 `qUdNh`）。
 *
 * 型（CreatePage）に、左の「開催回（どの回を変えるか選ぶ表）」「変える内容」と、
 * 右の「影響の確認」「日時・会場を変えるときの約束」をはめる。下の帯は キャンセル・変えてお知らせする。
 * 処理は今の作りと同じ口（change-review-model.ts の写し）。V8 は入力を変えると自動で影響を確かめる。
 */
import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Check } from 'lucide-react'
import { usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import TargetMissing from '@/components/shared/target-missing'
import { isoToLocalInput, noticeMessage, previewErrorMessage, useChangeReview, type SlotEdit } from './change-review-model'
import { jstDay, jstTime } from './shared'
import styles from './change-review.module.css'

/** datetime-local（日本時間の壁時計）→「10:30」。 */
function localTime(local: string): string {
  return local.split('T')[1]?.slice(0, 5) ?? '—'
}
/** datetime-local → 「10/12（月）」。 */
function localDay(local: string): string {
  const date = local.split('T')[0]
  return date ? jstDay(`${date}T00:00:00+09:00`) : '—'
}

export default function EventChangeReviewV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <ChangeReviewEntry />
    </Suspense>
  )
}

function ChangeReviewEntry() {
  const id = useSearchParams().get('id')
  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="確認するイベントが指定されていません"
        description="一覧から、変更を確認するイベントを選び直してください。"
        backHref="/events"
        backLabel="イベント一覧へ戻る"
      />
    )
  }
  return <ChangeReview eventId={id} />
}

function ChangeReview({ eventId }: { eventId: string }) {
  usePageTitle('変更の確認')
  const {
    selectedAccountId, status, event, slotList, edits, setEdits, venueName, setVenueName, venueUrl, setVenueUrl,
    preview, previewBusy, previewError, reason, setReason, applyBusy, applyError, applied, isPublished,
    refresh, touchEdits, runApply,
  } = useChangeReview(eventId)
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [venueOpen, setVenueOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const back = <Link href="/events" className={styles.backLink}><ArrowLeft size={14} aria-hidden="true" />イベント予約へ</Link>
  const description = '開催回の日時・定員・受付を変えます。変える前に、申し込んでいる人への影響を確かめます。'

  if (!selectedAccountId || status !== 'ready' || !event) {
    return (
      <CreatePage
        boardId="hmr2P"
        title="変更の確認"
        description={description}
        identity={back}
        footerActions={<Button href="/events">一覧へ戻る</Button>}
      >
        {!selectedAccountId ? (
          <ListState kind="empty" title="上のバーでLINE公式アカウントを選んでください" />
        ) : status === 'loading' ? (
          <ListState kind="loading" />
        ) : status === 'error' ? (
          <ListState
            kind="error"
            description="イベントは消えていません。開き直しても直らない場合はエラー報告へ。"
            action={<Button onClick={() => void refresh()}>開き直す</Button>}
          />
        ) : (
          <TargetMissing
            kind="not-found"
            title="イベントが見つかりません"
            description="削除されたか、別のアカウントのイベントです。一覧から選び直してください。"
            backHref="/events"
            backLabel="イベント一覧へ戻る"
          />
        )}
      </CreatePage>
    )
  }

  const activeSlot = slotList.find((slot) => slot.id === selectedSlotId) ?? slotList[0] ?? null
  const activeEdit: SlotEdit | null = activeSlot
    ? (edits[activeSlot.id] ?? { startsAt: '', endsAt: '', capacity: '', isActive: true })
    : null
  const impactBySlot = new Map((preview?.impacts ?? []).map((impact) => [impact.slot_id, impact]))
  const updateActive = (patch: Partial<SlotEdit>) => {
    if (!activeSlot || !activeEdit) return
    setEdits((current) => ({ ...current, [activeSlot.id]: { ...activeEdit, ...patch } }))
    touchEdits()
  }

  /* 日時が動いた最初の回（右の「変える前 → 変えた後」と送る文の見本に使う）。 */
  const moved = slotList.map((slot) => ({ slot, edit: edits[slot.id] })).find(({ slot, edit }) =>
    edit && (edit.startsAt !== isoToLocalInput(slot.starts_at) || edit.endsAt !== isoToLocalInput(slot.ends_at)))
  const beforeRange = moved ? `${jstTime(moved.slot.starts_at)}〜${jstTime(moved.slot.ends_at)}` : ''
  const afterRange = moved?.edit ? `${localTime(moved.edit.startsAt)}〜${localTime(moved.edit.endsAt)}` : ''
  const sampleText = moved?.edit
    ? `イベントの内容が変更になりました。イベント：${event.name}　日時：${localDay(moved.edit.startsAt)} ${afterRange}（変更前 ${jstDay(moved.slot.starts_at)} ${beforeRange}）`
    : ''
  const notes = (preview?.impacts ?? []).flatMap((impact) => [
    ...impact.errors.map((code) => previewErrorMessage(code)),
    ...impact.notices.map((code) => noticeMessage(code)),
  ])
  const reasonMissing = isPublished && !reason.trim()
  const canApply = Boolean(preview && !preview.blocked && !applyBusy && !reasonMissing)

  const side = (
    <div className={styles.side}>
      <section className={`${styles.sideCard} ${styles.impactCard}`} aria-labelledby="ev-cr-impact" aria-live="polite">
        <h2 className={styles.sideTitle} id="ev-cr-impact">影響の確認</h2>
        {preview ? (
          <>
            <div className={preview.blocked ? styles.bandDanger : styles.band}>
              <p className={styles.bandTitle}>{preview.blocked ? 'このままでは変えられません' : moved ? '日時が変わります' : '内容が変わります'}</p>
              <p className={styles.bandText}>
                確定した申込 {preview.total_confirmed} 人へ、LINE で新旧の日時をお知らせします。キャンセル待ち {preview.total_waiting} 人は順番のままです。
              </p>
            </div>
            {moved ? (
              <div className={styles.beforeAfter}>
                <p className={styles.beforeAfterLabel}>変える前 → 変えた後</p>
                <p className={styles.beforeAfterValue}>{`${beforeRange} → ${afterRange}`}</p>
              </div>
            ) : null}
            {sampleText ? (
              <div className={styles.lineBack} aria-label="送るお知らせの見本">
                <p className={styles.lineBubble} title={sampleText}>{sampleText}</p>
              </div>
            ) : null}
            {notes.length > 0 ? (
              <ul className={styles.noteList}>{notes.map((text) => <li key={text}>{text}</li>)}</ul>
            ) : null}
          </>
        ) : (
          <p className={styles.sideNote}>
            {previewBusy ? '影響を確かめています…' : previewError || '左で日時・定員・受付を変えると、ここに誰への影響が出ます。'}
          </p>
        )}
      </section>
      <section className={styles.sideCard} aria-labelledby="ev-cr-promise">
        <h2 className={styles.sideTitle} id="ev-cr-promise">日時・会場を変えるときの約束</h2>
        <p className={styles.promise}>
          ・変えた内容は記録に残ります（消すことはできません）<br />
          ・定員を、すでに申し込まれている人数より下げることはできません<br />
          ・日時・会場が動いた回の確定した申込へは、LINE で新旧をお知らせします
        </p>
      </section>
    </div>
  )

  return (
    <CreatePage
      boardId="hmr2P"
      title={`変更の確認：${event.name}`}
      description={description}
      identity={back}
      preview={side}
      footerActions={(
        <>
          <Button href={`/events/edit?id=${encodeURIComponent(eventId)}`}>キャンセル</Button>
          <Button
            variant="primary"
            disabled={!canApply}
            busy={applyBusy}
            busyLabel="変えています…"
            title={!preview ? '日時・定員・受付を変えると押せます' : reasonMissing ? '変える理由を書くと押せます' : undefined}
            onClick={() => setConfirmOpen(true)}
          >
            <Check size={15} aria-hidden="true" />変えてお知らせする
          </Button>
        </>
      )}
    >
      {applied ? (
        <Notice tone="success">
          変えました。確定 {applied.confirmed} 人・待ち {applied.waiting} 人に影響し、LINE のお知らせは {applied.notified} 人に送りました。
        </Notice>
      ) : null}
      {applyError ? <Notice tone="danger">{applyError}</Notice> : null}

      <section className={styles.card} aria-labelledby="ev-cr-slots">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="ev-cr-slots">開催回</h2>
          <p className={styles.cardNote}>変える回を選びます</p>
        </div>
        {slotList.length === 0 ? (
          <p className={styles.cardNote}>開催回がありません。編集で開催回を足してから、もう一度開いてください。</p>
        ) : (
          <div className={styles.table} role="radiogroup" aria-label="変える回">
            <div className={styles.headRow} aria-hidden="true">
              <span className={styles.cellStart}>開始</span>
              <span className={styles.cellNum}>定員</span>
              <span className={styles.cellNum}>確定</span>
              <span className={styles.cellNum}>待ち</span>
              <span className={styles.cellState}>受付</span>
            </div>
            {slotList.map((slot) => {
              const impact = impactBySlot.get(slot.id)
              const selected = slot.id === activeSlot?.id
              const ended = Date.parse(slot.ends_at) < Date.now()
              return (
                <button
                  key={slot.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? `${styles.row} ${styles.rowSelected}` : styles.row}
                  onClick={() => setSelectedSlotId(slot.id)}
                >
                  <span className={styles.cellStart}>{`${jstDay(slot.starts_at)}${jstTime(slot.starts_at)}〜${jstTime(slot.ends_at)}`}</span>
                  <span className={styles.cellNum}>{slot.capacity ?? '—'}</span>
                  <span className={styles.cellNum}>{impact ? impact.confirmed_seats : (slot.active_count ?? '—')}</span>
                  <span className={styles.cellNum}>{impact ? impact.waiting_seats : '—'}</span>
                  <span className={styles.cellState}>
                    {ended ? <span className={styles.chip}>終了</span>
                      : slot.is_active === 1 ? <span className={`${styles.chip} ${styles.chipOn}`}>受付する</span>
                        : <span className={styles.chip}>止めている</span>}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {activeSlot && activeEdit ? (
        <section className={styles.card} aria-labelledby="ev-cr-edit">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle} id="ev-cr-edit">変える内容</h2>
            <p className={styles.cardNote}>{`${jstDay(activeSlot.starts_at)}の回`}</p>
          </div>
          <div className={styles.pair}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ev-cr-start">開始日時</label>
              <input id="ev-cr-start" type="datetime-local" className={styles.input} value={activeEdit.startsAt} onChange={(e) => updateActive({ startsAt: e.target.value })} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ev-cr-end">終了日時</label>
              <input id="ev-cr-end" type="datetime-local" className={styles.input} value={activeEdit.endsAt} onChange={(e) => updateActive({ endsAt: e.target.value })} />
            </div>
          </div>
          <div className={styles.pair}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ev-cr-cap">定員</label>
              <input
                id="ev-cr-cap"
                inputMode="numeric"
                className={styles.input}
                value={activeEdit.capacity}
                placeholder="空欄で定員なし"
                onChange={(e) => updateActive({ capacity: e.target.value.replace(/[^0-9]/g, '') })}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.pickLabel}>受付の有無</span>
              <RadioCardGroup legend="受付の有無" className={styles.radioRow}>
                <RadioCard variant="row" name="ev-cr-active" value="on" checked={activeEdit.isActive} onChange={() => updateActive({ isActive: true })} title="受付する" />
                <RadioCard variant="row" name="ev-cr-active" value="off" checked={!activeEdit.isActive} onChange={() => updateActive({ isActive: false })} title="止める" />
              </RadioCardGroup>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ev-cr-reason">変える理由</label>
            <input
              id="ev-cr-reason"
              className={styles.input}
              value={reason}
              maxLength={500}
              placeholder="例：会場の都合で時間を30分遅らせます"
              aria-required={isPublished || undefined}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <p className={styles.note}>
            {isPublished ? '理由は変更の記録に残ります。友だちには送りません。公開中なので書かないと変えられません。' : '理由は変更の記録に残ります。友だちには送りません。'}
          </p>
          {venueOpen ? (
            <div className={styles.pair}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="ev-cr-venue">会場</label>
                <input id="ev-cr-venue" className={styles.input} value={venueName} placeholder="未設定" onChange={(e) => { setVenueName(e.target.value); touchEdits() }} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="ev-cr-url">オンラインの URL（確定した申込にだけ見せます）</label>
                <input id="ev-cr-url" type="url" className={styles.input} value={venueUrl} placeholder="未設定" onChange={(e) => { setVenueUrl(e.target.value); touchEdits() }} />
              </div>
            </div>
          ) : (
            <div className={styles.linkRow}>
              <button type="button" className={styles.linkButton} onClick={() => setVenueOpen(true)}>会場・オンラインの URL も変える</button>
            </div>
          )}
        </section>
      ) : null}

      <Dialog
        open={confirmOpen && Boolean(preview)}
        designNode="qUdNh"
        designWidth={620}
        designTop={185}
        confirmIcon={<Check size={15} aria-hidden="true" />}
        title="変更内容を確認"
        cancelLabel="戻って直す"
        confirmLabel={`変えて ${preview?.total_confirmed ?? 0} 人にお知らせする`}
        busy={applyBusy}
        onConfirm={() => { setConfirmOpen(false); void runApply() }}
        onCancel={() => setConfirmOpen(false)}
      >
        <div className={styles.confirmBody}>
          <dl className={styles.confirmList}>
            <div className={styles.confirmRow}>
              <dt>開催回</dt>
              <dd>{activeSlot ? `${event.name} ${jstDay((moved?.slot ?? activeSlot).starts_at)}` : event.name}</dd>
            </div>
            {moved ? (
              <div className={styles.confirmRow}>
                <dt>変える前 → 後</dt>
                <dd>{`${beforeRange} → ${afterRange}`}</dd>
              </div>
            ) : null}
            <div className={styles.confirmRow}>
              <dt>お知らせする人</dt>
              <dd>{`確定 ${preview?.total_confirmed ?? 0} 人`}</dd>
            </div>
            <div className={styles.confirmRow}>
              <dt>キャンセル待ち</dt>
              <dd>{`${preview?.total_waiting ?? 0} 人（順番はそのまま）`}</dd>
            </div>
          </dl>
          {sampleText ? <p className={styles.confirmSample}>{sampleText}</p> : null}
          <p className={styles.note}>LINE で友だちでない人には届きません。電話などでお知らせしてください。入力を変えると、この確認はやり直しになります。</p>
        </div>
      </Dialog>
    </CreatePage>
  )
}
