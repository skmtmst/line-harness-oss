'use client'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StickyBar from '@/components/shared/sticky-bar'
import { PageFrame, PageHeading, PageContent } from '@/components/templates/page-frame'
import Step4Template from './step4-template'
import { useRegistrationStyle } from './use-registration-style'
import { useState } from 'react'

export default function ResumeRegistrationStyle({ accountId }: { accountId: string }) {
  const state = useRegistrationStyle(accountId, true)
  const [done, setDone] = useState(false)
  return <PageFrame kind="wizard" boardId="X0pGdw">
    <PageHeading title={done ? '使い方を保存しました' : '使い方を選ぶ'} />
    <PageContent layout="stats">
      <Notice tone="info">LINEアカウントは登録済みです。同じアカウントの使い方を保存して続けます。</Notice>
      {state.error ? <ListState kind="error" title="使い方を確認・保存できませんでした" error={state.error} onRetry={state.reload} /> : null}
      {done ? <Button href={state.choice === 'restaurant' ? '/restaurant-test/stores/new' : '/hq'}>次へ</Button> : <Step4Template templateKey={state.choice} onPick={state.setChoice} />}
      <Button href={`/accounts/detail?id=${encodeURIComponent(accountId)}`}>登録したアカウントを見る</Button>
    </PageContent>
    {!done ? <StickyBar actions={<Button variant="primary" busy={state.busy} disabled={!state.choice || state.version === null} onClick={async () => { if (await state.save()) setDone(true) }}>使い方を保存する</Button>} /> : null}
  </PageFrame>
}
