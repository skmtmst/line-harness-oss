'use client'
import { AuthPage, AuthStack, AuthActions } from '@/components/templates/auth-page'
import { Steps } from '@/components/templates/steps'
import RecoveryCodeList from '@/components/shared/recovery-code-list'
import CopyTextButton from '@/components/shared/copy-text-button'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import SectionHeader from '@/components/shared/section-header'
import Notice from '@/components/shared/notice'
import { useState } from 'react'

/** Codes live only in component memory; never URL, storage or telemetry. */
export function RecoveryCodePanel({ codes, onContinue, continueLabel = '控えました。ログインする' }: { codes: string[]; onContinue: () => void; continueLabel?: string }) {
  const [error, setError] = useState('')
  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([codes.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = 'musubo-recovery-codes.txt'; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch { setError('ファイルに保存できませんでした。コピーして控えてください。') }
  }
  return <AuthStack>
    <RecoveryCodeList codes={codes} />
    <p>この画面を閉じると、もう表示されません。安全な所に控えてください。</p>
    <Button variant="primary" fullWidth onClick={onContinue}>{continueLabel}</Button>
    <Card surface="muted" padding="compact" layout="vertical" gap="normal">
      <SectionHeader title="控え方" />
      <AuthActions><CopyTextButton label="コピーする" aria-label="回復コードをコピー" value={codes.join('\n')} />
      <Button variant="text" onClick={download}>ファイルに保存する</Button></AuthActions>
    </Card>
    {error ? <Notice tone="danger" message={error} /> : null}
  </AuthStack>
}

export default function RecoveryCodes(props: { codes: string[]; onContinue: () => void }) {
  return <AuthPage title="回復コードを控えてください" help="認証アプリが使えない時に、1つにつき1回だけ使えます。" steps={<Steps label="二段階認証の設定" steps={[{ label: '二段階認証の設定', state: 'done' }, { label: '回復コード', state: 'current' }]} />}><RecoveryCodePanel {...props} /></AuthPage>
}
