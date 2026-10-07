'use client'

/*
 * ★V8-B 共通アクションを作る（Pencil `j2hfkS`）。
 *
 * 型（CreatePage）の左に段「どんなアクションか」「処理を上から順に並べる」「失敗したとき」、右の列に
 * 「版のこと」「つながる先」「気をつけること」。下の帯はキャンセル・下書きを保存を真ん中に。
 * データの口・保存（下書き＋要求キー）・選択肢の読み込みと失敗の扱いは今の V8（app/common-actions/common-action-new-v8.tsx）と同じ。
 * 見せ方を絵に合わせた：処理は番号つきの1行（何を・どれを）で並べ、行を押すとその処理の設定を開く。
 * 並べ替えは開いた設定の ↑↓。「失敗したとき」は全部の処理の「失敗したとき」をまとめて決める（行ごとに変えることもできる）。
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Save } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { api, describeSaveFailure, type CommonActionResources, type CommonActionStep } from '@/lib/api'
import CommonActionEditor, { newCommonActionStep, newStepId } from '@/components/automations/common-action-editor'
import { isForbiddenOrRateLimited, loadFailureNotice } from '@/components/shared/api-error-message'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import BranchEditors, { newBranchStep, updateBranchStep, type BranchPatch } from './branch-editor'
import { stepNumbers } from './action-order'
import { ACTION_LABELS } from './version-diff'
import styles from './common-action-new.module.css'

const EMPTY_RESOURCES: CommonActionResources = {
  tags: [], scenarios: [], templates: [], webhooks: [], richMenus: [], commonActions: [],
}

const FAILURE_OPTIONS = [
  { value: 'stop', label: 'ここで止める（残りの処理はしない）' },
  { value: 'continue', label: '次の処理へ進む' },
]

/** 処理の行の2行目（どれを・どれだけ）。選んでいないときは「〇〇を選ぶ」。 */
export function stepSummary(step: CommonActionStep, resources: CommonActionResources): string {
  const nameOf = (list: Array<{ id: string; name: string }>, id: unknown, label: string) => {
    const found = list.find((item) => item.id === String(id ?? ''))
    return found ? `${label}「${found.name}」` : `${label}を選ぶ`
  }
  switch (step.type) {
    case 'add_tag':
    case 'remove_tag':
      return nameOf(resources.tags, step.params.tagId, 'タグ')
    case 'start_scenario':
    case 'stop_scenario':
    case 'resume_scenario':
      return nameOf(resources.scenarios, step.params.scenarioId, 'シナリオ')
    case 'send_webhook':
      return nameOf(resources.webhooks, step.params.webhookId, '送信先')
    case 'switch_rich_menu':
      return nameOf(resources.richMenus, step.params.richMenuPageId, 'リッチメニュー')
    case 'common_action':
      return nameOf(resources.commonActions, step.params.commonActionId, '共通アクション')
    case 'send_message': {
      if (step.params.templateId) return nameOf(resources.templates, step.params.templateId, 'テンプレート')
      const content = String(step.params.content ?? '').trim()
      return content ? content.slice(0, 40) : '送る文を入れる'
    }
    case 'wait': {
      const minutes = Number(step.params.durationMinutes ?? step.params.minutes ?? 0)
      if (!minutes) return '待つ時間を決める'
      if (minutes % 1440 === 0) return `${minutes / 1440} 日`
      if (minutes % 60 === 0) return `${minutes / 60} 時間`
      return `${minutes} 分`
    }
    case 'set_metadata': {
      const keys = Object.keys((step.params.values as Record<string, unknown> | undefined) ?? {}).filter(Boolean)
      return keys.length ? `友だち情報「${keys.join('・')}」` : '友だち情報を選ぶ'
    }
    case 'branch':
      return '条件に合うとき・合わないときで分ける'
    default:
      return ''
  }
}

export function CommonActionNew() {
  usePageTitle('共通アクションを作る')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '共通アクション', href: '/common-actions' }])
  const canManage = useCanManageCommonActions()
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [actions, setActions] = useState<CommonActionStep[]>([newCommonActionStep()])
  const [openId, setOpenId] = useState<string | null>(null)
  const [resources, setResources] = useState<CommonActionResources>(EMPTY_RESOURCES)
  const [resourcesLoading, setResourcesLoading] = useState(true)
  const [resourcesFailed, setResourcesFailed] = useState(false)
  const [resourcesError, setResourcesError] = useState('')
  const [resourcesReloadKey, setResourcesReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [exampleOpen, setExampleOpen] = useState(false)
  const [exampleId, setExampleId] = useState('')
  const [requestKey] = useState(() => newStepId())

  useEffect(() => {
    if (accountLoading || canManage !== true || !selectedAccountId) {
      if (!accountLoading) setResourcesLoading(false)
      return
    }
    let cancelled = false
    setResourcesLoading(true)
    setResourcesFailed(false)
    setResourcesError('')
    api.commonActions.resources(selectedAccountId)
      .then((response) => {
        if (cancelled) return
        if (!response.success) {
          setResourcesFailed(true)
          setResourcesError(response.error || '選択肢を読み込めませんでした。通信の状態を確認して、もう一度読み込んでください。')
          return
        }
        setResources(response.data)
        setResourcesFailed(false)
        setResourcesError('')
      })
      .catch((caught) => {
        if (cancelled) return
        setResourcesFailed(true)
        if (isForbiddenOrRateLimited(caught)) {
          setResourcesError(loadFailureNotice(caught, '選択肢'))
          return
        }
        const message = caught instanceof Error ? caught.message : ''
        setResourcesError(message && !/^API error: /.test(message) ? message : '選択肢を読み込めませんでした。通信の状態を確認して、もう一度読み込んでください。')
      })
      .finally(() => {
        if (!cancelled) setResourcesLoading(false)
      })
    return () => { cancelled = true }
  }, [accountLoading, canManage, selectedAccountId, resourcesReloadKey])

  const save = async () => {
    if (!selectedAccountId) return setError('LINE公式アカウントを選んでください')
    if (!name.trim()) return setError('共通アクション名を入力してください')
    if (actions.length === 0) return setError('処理を1つ以上追加してください')
    setSaving(true)
    setError('')
    try {
      const response = await api.commonActions.create(selectedAccountId, {
        name: name.trim(),
        description: description.trim() || null,
        actions,
        clientRequestKey: requestKey,
      })
      if (!response.success) throw new Error(response.error)
      router.push(`/common-actions/versions?id=${encodeURIComponent(response.data.id)}`)
    } catch (caught) {
      setError(describeSaveFailure(caught))
    } finally {
      setSaving(false)
    }
  }

  const numbers = useMemo(() => stepNumbers(actions), [actions])
  /* 足した行は閉じたまま（2行目の「〇〇を選ぶ」で何を決めるかが分かる）。押すと設定を開く。 */
  const addStep = (step: CommonActionStep) => {
    setActions((current) => [...current, step])
  }
  const addExample = (id: string) => {
    if (!id) return
    addStep({ ...newCommonActionStep('common_action'), params: { commonActionId: id } })
    setExampleId('')
    setExampleOpen(false)
  }
  const move = (id: string, offset: -1 | 1) => {
    setActions((current) => {
      const index = current.findIndex((step) => step.id === id)
      const target = index + offset
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  /* 開いた設定（1つの処理）を直す・消す。 */
  const replaceStep = (id: string, next: CommonActionStep[]) => {
    setActions((current) => next.length ? current.map((step) => step.id === id ? next[0] : step) : current.filter((step) => step.id !== id))
    if (next.length === 0) setOpenId(null)
  }
  const updateBranch = (id: string, patch: BranchPatch) => {
    setActions((current) => current.map((step) => step.id === id ? updateBranchStep(step, patch) : step))
  }
  /* 失敗したとき：全部の処理が同じならその値、違えば「処理ごとに違う」。 */
  const failureValues = new Set(actions.map((step) => step.onFailure))
  const failureValue = failureValues.size === 1 ? [...failureValues][0] : 'mixed'
  const setAllFailure = (value: string) => {
    if (value !== 'stop' && value !== 'continue') return
    setActions((current) => current.map((step) => ({ ...step, onFailure: value })))
  }

  if (canManage === null) return <ListState kind="loading" title="権限を確認しています" />
  if (!canManage) {
    return (
      <div data-design-node="j2hfkS">
        <ListState
          kind="forbidden"
          title="共通アクションは閲覧のみです"
          description="作成するには、オーナーまたは管理者の権限が必要です。"
          action={<Button href="/common-actions">共通アクション一覧へ戻る</Button>}
        />
      </div>
    )
  }

  const back = <Link href="/common-actions" className={styles.backLink}>← 共通アクションへ</Link>
  const aside = (
    <div className={styles.aside}>
      <section className={styles.sideCard}>
        <h2 className={styles.sideTitle}>版のこと</h2>
        <div className={styles.kvRow}><span>いま公開中</span><strong>まだありません</strong></div>
        <div className={styles.kvRow}><span>保存すると</span><strong>版 1 の下書き</strong></div>
        <p className={styles.sideNote}>公開すると、ルール・シナリオ・リッチメニュー・回答フォーム・自動応答から選べるようになります。</p>
        <span className={styles.sideLink} title="保存したあと、版の画面で公開します。公開した版は書き換わらず、直すときは新しい版を作ります。">版のしくみ</span>
      </section>
      <section className={styles.sideCard}>
        <h2 className={styles.sideTitle}>つながる先</h2>
        <p className={styles.sideNote}>公開すると、ここに使っている所が出ます</p>
        {['オートメーション', 'シナリオ配信', 'リッチメニュー', '回答フォーム', '自動応答'].map((label) => (
          <div key={label} className={styles.kvRow}><span>{label}</span><strong>0</strong></div>
        ))}
      </section>
      <section className={styles.sideCard}>
        <h2 className={styles.sideTitle}>気をつけること</h2>
        <p className={styles.sideText}>・公開しても、使っている所は今の版のまま。使う所ごとに新しい版へ切り替えます<br />・待つ時間のあいだに条件が変わると、そのときの条件で分けます</p>
      </section>
    </div>
  )

  return (
    <CreatePage
      boardId="j2hfkS"
      title="共通アクションを作る"
      description="いくつもの所から呼び出せる「処理のまとまり」を作ります。ここでは下書きを保存し、公開は版の画面から行います。使う所はいまの版のまま。使う所ごとに新しい版へ更新します。"
      identity={back}
      preview={aside}
      footerActions={<>
        <Button href="/common-actions">キャンセル</Button>
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={saving || resourcesLoading || resourcesFailed}
          title={resourcesFailed ? '選択肢を読み込めていないため保存できません' : undefined}
          busy={saving}
          busyLabel="保存中"
        >
          <Save size={15} aria-hidden="true" />下書きを保存
        </Button>
      </>}
    >
      {error ? <Notice tone="danger" message={error} /> : null}

      <section className={styles.card} aria-labelledby="ca-what">
        <div className={styles.cardHead}><h2 className={styles.cardTitle} id="ca-what">どんなアクションか</h2></div>
        <label className={styles.field}>
          <span className={styles.label}>名前</span>
          <input className={styles.input} value={name} maxLength={120} placeholder="例：購入のお礼" onChange={(event) => setName(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>説明<span className={styles.optional}>任意</span></span>
          <input className={styles.input} value={description} maxLength={200} placeholder="使う場面や目的を書きます" onChange={(event) => setDescription(event.target.value)} />
        </label>
      </section>

      <section className={styles.card} aria-labelledby="ca-steps">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="ca-steps">処理を上から順に並べる</h2>
          <p className={styles.cardNote}>上から1つずつ動きます。↑↓で並べ替えます</p>
        </div>
        {resourcesLoading ? <ListState kind="loading" title="選択肢を読み込んでいます" /> : null}
        {!resourcesLoading && resourcesFailed ? (
          <div className={styles.errorBand} role="alert">
            <p>{`${resourcesError} 入力した名前や処理はそのままです。`}</p>
            <Button onClick={() => setResourcesReloadKey((key) => key + 1)}>選択肢をもう一度読み込む</Button>
          </div>
        ) : null}
        {actions.map((step, index) => {
          const open = openId === step.id
          const number = numbers[step.id] ?? index + 1
          return (
            <div key={step.id} className={styles.stepBox} data-open={open || undefined}>
              <button type="button" className={styles.stepRow} aria-expanded={open} onClick={() => setOpenId(open ? null : step.id)}>
                <span className={styles.stepNo}>{number}</span>
                <span className={styles.stepText}>
                  <span className={styles.stepTitle}>{ACTION_LABELS[step.type] ?? '処理'}</span>
                  <span className={styles.stepSub}>{stepSummary(step, resources)}</span>
                </span>
              </button>
              {open ? (
                <div className={styles.stepEditor}>
                  <div className={styles.stepMoves}>
                    <IconButton onClick={() => move(step.id, -1)} disabled={index === 0} aria-label={`${number}番目の処理を上へ`}><ArrowUp size={16} aria-hidden="true" /></IconButton>
                    <IconButton onClick={() => move(step.id, 1)} disabled={index === actions.length - 1} aria-label={`${number}番目の処理を下へ`}><ArrowDown size={16} aria-hidden="true" /></IconButton>
                  </div>
                  {step.type === 'branch' ? (
                    <BranchEditors
                      steps={[step]}
                      resources={resources}
                      onUpdate={updateBranch}
                      onRemove={(id) => { setActions((current) => current.filter((item) => item.id !== id)); setOpenId(null) }}
                    />
                  ) : (
                    <CommonActionEditor
                      value={[step]}
                      resources={resources}
                      resourcesFailed={resourcesFailed}
                      stepNumbers={{ [step.id]: number }}
                      onChange={(next) => replaceStep(step.id, next)}
                    />
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
        <div className={styles.addLinks}>
          <button type="button" className={styles.addLink} onClick={() => addStep(newCommonActionStep())}>＋ 処理を足す</button>
          <button type="button" className={styles.addLink} onClick={() => addStep(newCommonActionStep('wait'))}>待ち時間を入れる</button>
          <button type="button" className={styles.addLink} onClick={() => addStep(newBranchStep())}>条件で分ける</button>
          {resources.commonActions.length > 0 ? (
            exampleOpen ? (
              <span className={styles.exampleBox}>
                <Select aria-label="見本から受け渡す" value={exampleId} onChange={(value) => { setExampleId(value); addExample(value) }} options={[{ value: '', label: '見本を選ぶ' }, ...resources.commonActions.map((item) => ({ value: item.id, label: `${item.name} v${item.version}` }))]} />
              </span>
            ) : <button type="button" className={styles.addLink} onClick={() => setExampleOpen(true)}>見本から受け渡す</button>
          ) : null}
        </div>
      </section>

      <section className={styles.card} aria-labelledby="ca-failure">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="ca-failure">失敗したとき</h2>
          <p className={styles.cardNote}>送れなかった・タグが無いなど</p>
        </div>
        <div className={styles.field}>
          <span className={styles.pickLabel} id="ca-failure-pick">失敗したときにすること</span>
          <Select
            size="full"
            aria-label="失敗したときにすること"
            value={failureValue}
            onChange={setAllFailure}
            options={failureValue === 'mixed' ? [{ value: 'mixed', label: '処理ごとに違う（行を開いて確かめる）' }, ...FAILURE_OPTIONS] : FAILURE_OPTIONS}
          />
        </div>
      </section>
    </CreatePage>
  )
}
