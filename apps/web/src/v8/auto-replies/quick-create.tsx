'use client'

/*
 * ★V8 自動応答 かんたんに作る（板 `G4GejG`、小窓 560）。
 *
 * 言葉（どれか1つを含む）と返す文だけ聞いて、その場で有効にする。
 * 重なりは作った下書きで確かめ、あるときは相手の名前を帯に出してから
 * 有効にする（確かめた分だけ承認する）。並び替えは詳しく作るで行う。
 * 見た目は絵どおりに組み直した（2026-10-07）：× は題の行に重ねる、キャンセル・保存は窓の真ん中、
 * 言葉は札（緑の地・青の字）、重なりは琥珀の帯。インラインの style は使わない。
 */
import { useRef, useState } from 'react'
import Link from 'next/link'
import { HelpCircle, ListOrdered, Send, X } from 'lucide-react'
import Dialog from '@/components/shared/dialog'
import Button from '@/components/shared/button'
import { api, describeSaveFailure } from '@/lib/api'
import type { AutoReplyConflict, AutoReplyDraftInput } from '@line-crm/shared'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import styles from './quick-create.module.css'

/* 1欄ぶんの確かめ。文は「何をすれば直るか」を1文で書く。 */
function validateKeywords(keywords: string[]): string | null {
  return keywords.length > 0 ? null : '反応する言葉を1つ以上入れてください'
}

function validateReply(reply: string): string | null {
  return reply.trim() ? null : '返す内容を入力してください'
}

function overlapNames(conflicts: AutoReplyConflict[]): string {
  const names = conflicts.map((conflict) => conflict.name).filter(Boolean)
  if (names.length <= 3) return names.join('・')
  return `${names.slice(0, 3).join('・')}ほか${names.length - 3}件`
}

type Phase = 'editing' | 'confirming' | 'saving'

export default function QuickCreateV8({
  accountId,
  onClose,
  onCreated,
}: {
  /** 上のバーで選んでいるLINE公式アカウント。無いときは作れない。 */
  accountId: string | null
  onClose: () => void
  /** 有効にしたら一覧を読み直す。 */
  onCreated: () => void
}) {
  const [keywords, setKeywords] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [reply, setReply] = useState('')
  const [keywordError, setKeywordError] = useState('')
  const [replyError, setReplyError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [phase, setPhase] = useState<Phase>('editing')
  const [overlaps, setOverlaps] = useState<AutoReplyConflict[]>([])
  const draftIdRef = useRef<string | null>(null)
  const savedInputRef = useRef('')
  const draftVersionRef = useRef<number | null>(null)
  const savingRef = useRef(false)
  const acknowledgedRef = useRef<string[]>([])
  const draftKeyRef = useRef<string>(crypto.randomUUID())
  const publishKeyRef = useRef<string>(crypto.randomUUID())

  const saving = phase === 'saving'
  const guard = useUnsavedGuard({ dirty: keywords.length > 0 || draft !== '' || reply !== '', busy: saving, onDiscard: onClose })

  const addKeyword = (value: string) => {
    const word = value.trim()
    if (!word || keywords.includes(word)) return
    const next = [...keywords, word]
    setKeywords(next)
    if (validateKeywords(next) === null) setKeywordError('')
  }

  const removeKeyword = (value: string) => {
    setKeywords((current) => current.filter((keyword) => keyword !== value))
  }

  /* 欄を離れたとき、入れかけの言葉があれば札にする（Enter を押し忘れても消えない）。 */
  const blurKeywords = () => {
    const word = draft.trim()
    if (word) {
      const next = keywords.includes(word) ? keywords : [...keywords, word]
      setKeywords(next)
      setDraft('')
      setKeywordError(validateKeywords(next) ?? '')
      return
    }
    setKeywordError(validateKeywords(keywords) ?? '')
  }
  const blurReply = () => setReplyError(validateReply(reply) ?? '')

  const buildInput = (words: string[], text: string): AutoReplyDraftInput => ({
    keyword: words[0] ?? '',
    matchType: 'contains',
    responseType: 'text',
    responseContent: text.trim(),
    templateId: null,
    lineAccountId: accountId ?? '',
    activeFrom: null,
    activeUntil: null,
    cooldownMinutes: null,
    skipWhenOperatorActive: false,
    priority: 0,
    messageKinds: null,
    receiveSources: ['line'],
    friendConditions: null,
    actions: null,
    responseWeekdays: null,
    responseHolidayRule: null,
    oncePerFriend: false,
    keywords: words.map((word) => ({ keyword: word, matchType: 'contains' })),
    respondToAll: false,
    name: null,
    keywordMatchMode: 'any',
    folderId: null,
    internalMemo: null,
    replyDelaySeconds: null,
    unmatchedAction: null,
  })

  const publish = async (id: string, acknowledged: string[]) => {
    const res = await api.autoReplies.publishDraft(
      id,
      { acknowledgedConflictIds: acknowledged },
      publishKeyRef.current,
    )
    if (!res.success) {
      if (res.error?.includes('競合') || res.error?.includes('確認')) {
        throw new Error('重なりの確認が足りていません。詳しく作るで確かめてください。')
      }
      throw new Error(res.error || '自動応答を有効にできませんでした。')
    }
  }

  const save = async () => {
    if (savingRef.current) return
    const keywordMessage = validateKeywords(keywords)
    const replyMessage = validateReply(reply)
    setKeywordError(keywordMessage ?? '')
    setReplyError(replyMessage ?? '')
    if (keywordMessage || replyMessage) return
    if (!accountId) {
      setSaveError('上のバーでLINE公式アカウントを選んでください')
      return
    }
    savingRef.current = true
    setPhase('saving')
    setSaveError('')
    try {
      const input = buildInput(keywords, reply)
      const snapshot = JSON.stringify(input)
      let id = draftIdRef.current
      const changed = snapshot !== savedInputRef.current
      if (!id) {
        const created = await api.autoReplies.createDraft(input, draftKeyRef.current)
        if (!created.success) throw new Error(created.error || '下書きを作れませんでした')
        id = created.data.autoReplyId
        draftIdRef.current = id
        draftVersionRef.current = created.data.versionNumber
        savedInputRef.current = snapshot
      } else if (changed) {
        if (draftVersionRef.current === null) throw new Error('下書きの更新番号を確認できませんでした')
        const updated = await api.autoReplies.saveDraft(id, { ...input, expectedVersion: draftVersionRef.current })
        if (!updated.success) throw new Error(updated.error || '下書きを更新できませんでした')
        draftVersionRef.current = updated.data.versionNumber
        savedInputRef.current = snapshot
        publishKeyRef.current = crypto.randomUUID()
      }
      // 通信失敗を「重なりなし」と扱わず、公開の直前にも最新の重なりを確認する。
      const found = await api.autoReplies.conflicts(id)
      if (!found.success) throw new Error(found.error || '重なりを確認できませんでした')
      const list = found.data.conflicts
      const acknowledged = list.map(conflict => conflict.autoReplyId)
      const newConflicts = acknowledged.some(conflictId => !acknowledgedRef.current.includes(conflictId))
      setOverlaps(list)
      if (list.length > 0 && (changed || newConflicts)) {
        acknowledgedRef.current = acknowledged
        setPhase('confirming')
        return
      }
      acknowledgedRef.current = acknowledged
      await publish(id, acknowledged)
      publishKeyRef.current = crypto.randomUUID()
      guard.disarm()
      onCreated()
      onClose()
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : describeSaveFailure(cause))
      setPhase(draftIdRef.current ? 'confirming' : 'editing')
    } finally {
      savingRef.current = false
    }
  }

  return (
    <>
    <Dialog
      open
      confirmation
      designNode="G4GejG"
      designWidth={560}
      title="言葉に自動で返す"
      busy={saving}
      error={saveError || undefined}
      onCancel={onClose}
      footer={(
        <div className={styles.footer}>
          <Link href="/auto-replies/edit" className={styles.detailLink}>
            <ListOrdered size={15} aria-hidden="true" />
            詳しく作るへ
          </Link>
          <span className={styles.footerSpacer} aria-hidden="true" />
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            キャンセル
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving}
            busy={saving}
            busyLabel={phase === 'confirming' ? '有効にしています…' : '保存しています…'}
            onClick={() => void save()}
          >
            <Send size={15} aria-hidden="true" />
            有効にして保存
          </Button>
          <span className={styles.footerSpacer} aria-hidden="true" />
          {/* 左の「詳しく作るへ」と釣り合いを取り、キャンセル・保存を窓の真ん中に置く。 */}
          <span className={styles.footerBalance} aria-hidden="true" />
        </div>
      )}
    >
      <div className={styles.body}>
        <div className={styles.field}>
          <p className={styles.label} id="quick-create-keywords-label">この言葉が来たら（どれか1つを含む）</p>
          <div className={styles.chipBox} role="group" aria-labelledby="quick-create-keywords-label">
            {keywords.map((keyword) => (
              <span key={keyword} className={styles.chip}>
                {keyword}
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={`「${keyword}」を外す`}
                  onClick={() => removeKeyword(keyword)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={blurKeywords}
              onKeyDown={(event) => {
                // 空の欄で Backspace を押すと、最後の札を外す（札の×は指を乗せたとき・選んだときだけ見せる）。
                if (event.key === 'Backspace' && !draft && keywords.length > 0) {
                  removeKeyword(keywords[keywords.length - 1])
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addKeyword(draft)
                  setDraft('')
                }
              }}
              placeholder="言葉を入れて Enter"
              aria-label="追加する言葉"
              className={styles.chipInput}
            />
          </div>
          {keywordError ? <p className={styles.fieldError} role="alert">{keywordError}</p> : null}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="quick-create-reply">返す文</label>
          <textarea
            id="quick-create-reply"
            value={reply}
            onChange={(event) => {
              const next = event.target.value
              setReply(next)
              if (replyError && validateReply(next) === null) setReplyError('')
            }}
            onBlur={blurReply}
            placeholder="例：営業時間は10:00〜19:00です"
            className={styles.textarea}
            aria-invalid={replyError ? true : undefined}
          />
          {replyError ? <p className={styles.fieldError} role="alert">{replyError}</p> : null}
        </div>
        {overlaps.length > 0 ? (
          <p className={styles.overlapBand} role="status">
            <HelpCircle size={16} aria-hidden="true" className={styles.overlapIcon} />
            <span>{`「${overlapNames(overlaps)}」と重なります。こちらが先に動きます（並びは詳しく作るで変えられる）`}</span>
          </p>
        ) : null}
      </div>
    </Dialog>
    <UnsavedLeaveDialog open={guard.leaveTarget !== null} busy={saving} onConfirm={guard.confirmLeave} onCancel={guard.cancelLeave} />
    </>
  )
}
