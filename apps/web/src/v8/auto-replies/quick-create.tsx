'use client'

/*
 * ★V8 自動応答 かんたんに作る（板 `G4GejG`、小窓 560）。
 *
 * 言葉（どれか1つを含む）と返す文だけ聞いて、その場で有効にする。
 * 重なりは作った下書きで確かめ、あるときは相手の名前を帯に出してから
 * 有効にする（確かめた分だけ承認する）。並び替えは詳しく作るで行う。
 * 詳しい手順（Xr6eu の分け方）は P6vbxn 未統合のため別途。
 */
import { useRef, useState } from 'react'
import Link from 'next/link'
import { Info, ListOrdered, Send } from 'lucide-react'
import Dialog from '@/components/shared/dialog'
import Button from '@/components/shared/button'
import { api, describeSaveFailure } from '@/lib/api'
import type { AutoReplyConflict, AutoReplyDraftInput } from '@line-crm/shared'
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
  const acknowledgedRef = useRef<string[]>([])
  const draftKeyRef = useRef<string>(crypto.randomUUID())
  const publishKeyRef = useRef<string>(crypto.randomUUID())

  const saving = phase === 'saving'

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

  const blurKeywords = () => setKeywordError(validateKeywords(keywords) ?? '')
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
    if (saving) return
    const keywordMessage = validateKeywords(keywords)
    const replyMessage = validateReply(reply)
    setKeywordError(keywordMessage ?? '')
    setReplyError(replyMessage ?? '')
    if (keywordMessage || replyMessage) return
    if (!accountId) {
      setSaveError('上のバーでLINE公式アカウントを選んでください')
      return
    }
    setPhase('saving')
    setSaveError('')
    try {
      let id = draftIdRef.current
      let acknowledged = acknowledgedRef.current
      if (!id) {
        const created = await api.autoReplies.createDraft(
          buildInput(keywords, reply),
          draftKeyRef.current,
        )
        if (!created.success) throw new Error(created.error || '下書きを作れませんでした')
        id = created.data.autoReplyId
        draftIdRef.current = id
        const found = await api.autoReplies.conflicts(id).catch(() => null)
        const list = found?.success ? found.data.conflicts : []
        acknowledged = list.map((conflict) => conflict.autoReplyId)
        acknowledgedRef.current = acknowledged
        if (list.length > 0) {
          setOverlaps(list)
          setPhase('confirming')
          return
        }
      }
      await publish(id, acknowledged)
      publishKeyRef.current = crypto.randomUUID()
      onCreated()
      onClose()
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : describeSaveFailure(cause))
      setPhase(draftIdRef.current ? 'confirming' : 'editing')
    }
  }

  return (
    <Dialog
      open
      confirmation
      designNode="G4GejG"
      title="言葉に自動で返す"
      busy={saving}
      error={saveError || undefined}
      onCancel={onClose}
      footer={(
        <div className={styles.footer}>
          <Link href="/auto-replies/edit" className={styles.detailLink} style={{ gap: 6 }}>
            <ListOrdered size={15} aria-hidden="true" />
            詳しく作るへ
          </Link>
          <span className={styles.footerSpacer} />
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
            <Send size={15} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -2 }} />
            有効にして保存
          </Button>
        </div>
      )}
    >
      <div className={styles.field} style={{ marginBottom: 16 }}>
        <p className={styles.label} id="quick-create-keywords-label" style={{ marginBottom: 6 }}>この言葉が来たら（どれか1つを含む）</p>
        <div
          className={styles.chipBox} style={{ gap: 6, minHeight: 36, padding: '4px 8px' }}
          role="group"
          aria-labelledby="quick-create-keywords-label"
        >
          {keywords.map((keyword) => (
            <span key={keyword} className={styles.chip} style={{ padding: '2px 4px 2px 10px' }}>
              {keyword}
              <button
                type="button"
                className={styles.chipRemove} style={{ width: 20, height: 20 }}
                aria-label={`「${keyword}」を外す`}
                onClick={() => removeKeyword(keyword)}
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={blurKeywords}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addKeyword(draft)
                setDraft('')
              }
            }}
            placeholder={keywords.length === 0 ? '言葉を入れて Enter' : ''}
            aria-label="追加する言葉"
            className={styles.chipInput} style={{ minWidth: 140 }}
          />
        </div>
        {keywordError ? <p className={styles.fieldError} role="alert">{keywordError}</p> : null}
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="quick-create-reply" style={{ marginBottom: 6 }}>返す文</label>
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
          rows={4}
          className={styles.textarea} style={{ padding: '8px 12px' }}
          aria-invalid={replyError ? true : undefined}
        />
        {replyError ? <p className={styles.fieldError} role="alert">{replyError}</p> : null}
      </div>
      {overlaps.length > 0 ? (
        <p className={styles.overlapBand} role="status" style={{ gap: 12, margin: '12px 0 0', padding: '8px 12px' }}>
          <Info size={14} aria-hidden="true" className={styles.overlapIcon} />
          <span>「{overlapNames(overlaps)}」と重なります。こちらが先に動きます（並びは詳しく作るで変えられる）</span>
        </p>
      ) : null}
    </Dialog>
  )
}
