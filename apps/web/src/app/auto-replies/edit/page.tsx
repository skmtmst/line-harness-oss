'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { usePageTitle } from '@/components/shell/page-chrome'
import Stepper, { type StepperStep } from '@/components/shared/stepper'
import Notice from '@/components/shared/notice'
import TargetMissing from '@/components/shared/target-missing'
import { isForbiddenOrRateLimited, loadFailureNotice } from '@/components/shared/api-error-message'
import EditDialog, { toVersionDraft, type AutoReplyDraft } from '@/components/auto-replies/edit-dialog'
import './issue481-height.css'

/*
 * 作成の手順。ウェビナー作成・イベント作成などと同じ共通部品で出す
 * （U049: 画面ごとに違う手順表示を1つのStepperへ寄せる）。
 * この部品を編集ダイアログの内側に置くと、手順を持たない一覧画面にも
 * 「Steps」の節が混入するため、ページ側で描く。
 */
const STEP_LABELS = ['基本設定', 'どんなときに動くか', '何を返すか', '優先順位', '確認'] as const

/**
 * 自動応答の編集を、URL で開けるようにする。
 *
 * 中身は一覧で使っているダイアログをそのまま出す。編集の中身を2つ持つと、
 * 片方だけ直したときに食い違う。
 */
/**
 * R527: 作成・編集のURLを直接開いた見るだけにも、保存の入口を出さない。
 * 口側の下書き・検証・公開は owner/admin だけなので、画面も同じ境目で分ける。
 */
const NO_MANAGE_NOTE = '自動応答の作成・変更はオーナーと管理者だけができます。必要なときはオーナーか管理者に頼んでください。'

function AutoReplyEditInner() {
  const router = useRouter()
  const params = useSearchParams()
  const staffRole = useStaffRole()
  const canManage = staffRole === null || canManageRole(staffRole)
  const id = params.get('id')
  const requestedStep = params.get('step')
  const step = requestedStep === 'trigger' || requestedStep === 'response' ? requestedStep : 'basic'
  const currentStep = step === 'basic' ? 0 : step === 'trigger' ? 1 : 2
  const stepLabel = step === 'basic' ? '基本設定' : step === 'trigger' ? 'どんなときに動くか' : '何を返すか'
  usePageTitle(`自動応答ルールを作成・${stepLabel}`)

  const [draft, setDraft] = useState<AutoReplyDraft | null>(null)
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; messageType: string; messageContent: string }>
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // R528: 捕まえた取得失敗そのもの。TargetMissingのerrorへ渡す
  // （403は再試行なし・429は待ち案内）。
  const [loadError, setLoadError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setLoadError(null)
    try {
      const [draftRes, liveRes] = await Promise.all([
        id ? api.autoReplies.getDraft(id) : Promise.resolve(null),
        id ? api.autoReplies.get(id).catch(() => null) : Promise.resolve(null),
      ])
      // R23横展開: 返す文の候補は、この応答のアカウントだけ。新規は全体。
      const draftAccountId = draftRes?.success ? draftRes.data.settings.lineAccountId : null
      const tplRes = await api.templates.list(undefined, draftAccountId ?? undefined)
      if (tplRes.success) {
        setTemplates(
          tplRes.data.map((t) => ({
            id: t.id,
            name: t.name,
            messageType: t.messageType,
            messageContent: t.messageContent,
          })),
        )
      }
      if (id) {
        if (draftRes?.success) {
          const [conflictRes, summaryRes] = await Promise.all([
            api.autoReplies.conflicts(id).catch(() => null),
            api.autoReplies.summary(draftRes.data.settings.lineAccountId).catch(() => null),
          ])
          setDraft(toVersionDraft(draftRes.data, {
            isActive: liveRes?.success ? liveRes.data.isActive : true,
            conflictAttentionCount: conflictRes?.success ? conflictRes.data.conflicts.length : null,
            receiveSourceCounts: summaryRes?.success ? summaryRes.data.receiveSourceCounts : null,
          }))
        } else {
          setError(draftRes?.error ?? '下書きを読み込めませんでした')
        }
      } else {
        setDraft({
          keyword: '',
          matchType: 'exact',
          responseType: 'text',
          responseContent: '',
          templateId: null,
          lineAccountId: null,
          // AUTOREPLY-08: 新しい応答は止まった状態で作る。
          isActive: false,
          priority: 0,
          messageKinds: null,
        })
      }
    } catch (caught) {
      setLoadError(caught)
      if (isForbiddenOrRateLimited(caught)) {
        setError(loadFailureNotice(caught, '下書き'))
      } else {
        const message = caught instanceof Error ? caught.message : ''
        setError(message && !/^API error: /.test(message) ? message : '読み込みに失敗しました。もう一度読み込んでください。')
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    let active = true
    void (async () => {
      if (!active) return
      await load()
    })()
    return () => {
      active = false
    }
  }, [load])

  return (
    <div data-issue481-height>
      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/auto-replies" className="hover:underline">
          自動応答
        </Link>
        <span className="mx-1.5">›</span>
        <span>{id ? '編集' : '作成'}</span>
      </nav>

      {!loading && !canManage && (
        <p className="bg-info-bg text-ink-secondary rounded-control mb-4 px-4 py-3 text-xs leading-relaxed">
          {NO_MANAGE_NOTE}
        </p>
      )}

      {error && canManage && (
        id && !draft && !loading ? null : (
          <Notice tone="danger" message={error} onClose={() => setError('')} className="mb-4" />
        )
      )}

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : id && !draft ? (
        canManage ? (
          <TargetMissing
            kind="error"
            title="下書きを読み込めませんでした"
            description={error || '通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。'}
            error={loadError ?? undefined}
            onRetry={() => void load()}
          />
        ) : null
      ) : draft && canManage ? (
        <>
        <Stepper
          label="自動応答を作る進み方"
          steps={STEP_LABELS.map(
            (label, index): StepperStep => ({
              label,
              state: index < currentStep ? 'done' : index === currentStep ? 'current' : 'todo',
            }),
          )}
        />
        <EditDialog
          page
          step={step}
          draft={draft}
          templates={templates}
          onClose={() => router.push('/auto-replies')}
          onSaved={() => router.push('/auto-replies')}
          onStepChange={(nextStep) => {
            const query = new URLSearchParams()
            if (id) query.set('id', id)
            query.set('step', nextStep)
            router.replace(`/auto-replies/edit?${query.toString()}`)
          }}
        />
        </>
      ) : null}
    </div>
  )
}

export default function AutoReplyEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <AutoReplyEditInner />
    </Suspense>
  )
}
