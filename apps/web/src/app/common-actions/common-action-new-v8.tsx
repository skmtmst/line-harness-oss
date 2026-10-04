'use client'

/*
 * ★V8-B 共通アクションを作る（板 `j2hfkS`）。
 *
 * v7（new/page.tsx の器）とは別の器。データの口・動きは v7 と同じ
 * （選択肢・下書き保存・版の約束・つながる先）。
 * 処理の段の器は共通の部品（CommonActionEditor・BranchEditors）を
 * そのまま使う。
 * v7 を直す必要が出たら new/page.tsx 側も同じ判断を入れる。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  describeSaveFailure,
  type CommonActionResources,
  type CommonActionStep,
} from '@/lib/api'
import CommonActionEditor, { newCommonActionStep, newStepId } from '@/components/automations/common-action-editor'
import { isForbiddenOrRateLimited, loadFailureNotice } from '@/components/shared/api-error-message'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import ListState from '@/components/shared/list-state'
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import { TextField } from '@/components/shared/text-field'
import Select from '@/components/shared/select'
import { usePageTitle } from '@/components/shell/page-chrome'
import BranchEditors, { newBranchStep, updateBranchStep, type BranchPatch } from './branch-editor'
import { mergeOrderedActions, stepNumbers } from './action-order'
import styles from '@/app/automations/automations-v8.module.css'

const EMPTY_RESOURCES: CommonActionResources = {
  tags: [], scenarios: [], templates: [], webhooks: [], richMenus: [], commonActions: [],
}

export function CommonActionNewV8() {
  usePageTitle('共通アクションを作る')
  const canManage = useCanManageCommonActions()
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [actions, setActions] = useState<CommonActionStep[]>([newCommonActionStep()])
  const [resources, setResources] = useState<CommonActionResources>(EMPTY_RESOURCES)
  const [resourcesLoading, setResourcesLoading] = useState(true)
  const [resourcesFailed, setResourcesFailed] = useState(false)
  const [resourcesError, setResourcesError] = useState('')
  const [resourcesReloadKey, setResourcesReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
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
    if (!selectedAccountId) {
      setError('LINE公式アカウントを選んでください')
      return
    }
    if (!name.trim()) {
      setError('共通アクション名を入力してください')
      return
    }
    if (actions.length === 0) {
      setError('処理を1つ以上追加してください')
      return
    }
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

  const addExample = (id: string) => {
    if (!id) return
    setActions((current) => [...current, { ...newCommonActionStep('common_action'), params: { commonActionId: id } }])
  }

  const plainActions = actions.filter((action) => action.type !== 'branch')

  const updatePlainActions = (next: CommonActionStep[]) =>
    setActions((current) => mergeOrderedActions(current, next))

  const updateBranch = (id: string, patch: BranchPatch) => {
    setActions((current) => current.map((step) => step.id === id ? updateBranchStep(step, patch) : step))
  }

  if (canManage === null) {
    return <ListState kind="loading" title="権限を確認しています" />
  }

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

  return (
    <div data-design-node="j2hfkS">
      <div className={styles.head}>
        <div className={styles.headText}>
          <Link href="/common-actions" className={styles.backLink}>← 共通アクションへ</Link>
          <h1 className={styles.headTitle}>共通アクションを作る</h1>
          <p className={styles.headDescription}>
            いくつもの所から呼び出せる「処理のまとまり」を作ります。ここでは下書きを保存し、公開は版の画面から行います。使う所はいまの版のまま。使う所ごとに新しい版へ更新します。
          </p>
        </div>
      </div>

      <div className={styles.columns}>
        <div className={styles.main}>
          <section className={styles.formCard}>
            <h2 className={styles.formTitle}>どんなアクションか</h2>
            <div className={styles.formGrid}>
              <label className={styles.fieldLabel} htmlFor="v8-common-action-name">
                名前
                <TextField
                  id="v8-common-action-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  placeholder="例：購入のお礼"
                />
              </label>
              <label className={styles.fieldLabel} htmlFor="v8-common-action-description">
                説明 <span className={styles.optional}>任意</span>
                <TextField
                  id="v8-common-action-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={200}
                  placeholder="使う場面や目的を書きます"
                />
              </label>
            </div>
          </section>

          <section className={styles.formCard}>
            <h2 className={styles.formTitle}>処理を上から順に並べる</h2>
            <p className={styles.footnote}>上から1つずつ動きます。途中で失敗したときの動きも、行ごとに決められます。公開後の版は書き換わりません。</p>
            {resourcesLoading ? (
              <ListState kind="loading" title="選択肢を読み込んでいます" />
            ) : (
              <CommonActionEditor value={plainActions} resources={resources} resourcesFailed={resourcesFailed} stepNumbers={stepNumbers(actions)} onChange={updatePlainActions} />
            )}
            {!resourcesLoading && resourcesFailed ? (
              <div className={styles.errorBand} role="alert">
                <div>
                  <p className={styles.formTitle}>選択肢を読み込めませんでした</p>
                  <p className={styles.footnote}>{resourcesError} 入力した名前や処理はそのままです。</p>
                </div>
                <Button onClick={() => setResourcesReloadKey((key) => key + 1)}>選択肢をもう一度読み込む</Button>
              </div>
            ) : null}
            <BranchEditors
              steps={actions}
              resources={resources}
              onUpdate={updateBranch}
              onRemove={(id) => setActions((current) => current.filter((item) => item.id !== id))}
            />
            <div className={styles.toolbar}>
              <Button onClick={() => setActions((current) => [...current, newCommonActionStep()])} variant="secondary" size="compact">処理を足す</Button>
              <Button onClick={() => setActions((current) => [...current, newBranchStep()])} variant="secondary" size="compact">条件で分ける</Button>
              <Button onClick={() => setActions((current) => [...current, newCommonActionStep('wait')])} variant="secondary" size="compact">待ち時間を入れる</Button>
              {resources.commonActions.length > 0 ? (
                <label className={styles.inlineField}>
                  <span>見本から受け渡す</span>
                  <Select aria-label="見本から受け渡す" value={exampleId} onChange={(value) => { setExampleId(value); addExample(value) }} options={[{ value: '', label: '選ぶ' }, ...resources.commonActions.map((item) => ({ value: item.id, label: `${item.name} v${item.version}` }))]} />
                </label>
              ) : null}
            </div>
          </section>

          {error ? <p className={styles.stepError} role="alert">{error}</p> : null}
        </div>

        <aside className={styles.rail}>
          <section className={styles.formCard}>
            <h2 className={styles.formTitle}>版のこと</h2>
            <dl className={styles.kvList}>
              <div className={styles.kvRow}>
                <dt className={styles.kvKey}>いま公開中</dt>
                <dd className={styles.kvValue}>まだありません</dd>
              </div>
              <div className={styles.kvRow}>
                <dt className={styles.kvKey}>保存すると</dt>
                <dd className={styles.kvValue}>版 1 の下書き</dd>
              </div>
            </dl>
            <p className={styles.footnote}>
              公開すると、ルール・シナリオ・リッチメニュー・回答フォーム・自動応答から選べるようになります。
            </p>
          </section>
          <section className={styles.formCard}>
            <h2 className={styles.formTitle}>つながる先</h2>
            <p className={styles.footnote}>公開すると、ここに使っている所が出ます。</p>
            <dl className={styles.kvList}>
              {['オートメーション', 'シナリオ配信', 'リッチメニュー', '回答フォーム', '自動応答'].map((label) => (
                <div key={label} className={styles.kvRow}>
                  <dt className={styles.kvKey}>{label}</dt>
                  <dd className={styles.kvValue}>0</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className={styles.formCard}>
            <h2 className={styles.formTitle}>気をつけること</h2>
            <ul className={styles.noteList}>
              <li>公開しても、使っている所はいまの版のまま。使う所ごとに新しい版へ切り替えます</li>
              <li>待つ時間のあいだに条件が変わると、そのときの条件で分けます</li>
            </ul>
          </section>
        </aside>
      </div>

      <StickyBar
        status={saving ? '下書きを保存しています' : resourcesFailed ? '選択肢を読み込めていないため保存できません' : 'まだ保存していません'}
        actions={(
          <>
            <Button href="/common-actions">キャンセル</Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving || resourcesLoading || resourcesFailed} title={resourcesFailed ? '選択肢を読み込めていないため保存できません' : undefined} busy={saving} busyLabel="保存中">下書きを保存
            </Button>
          </>
        )}
      />
    </div>
  )
}
