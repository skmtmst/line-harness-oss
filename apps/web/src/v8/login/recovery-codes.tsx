'use client'
import { AuthPage, AuthStack } from '@/components/templates/auth-page'
import CodeBlock from '@/components/shared/code-block'
import CopyTextButton from '@/components/shared/copy-text-button'
import Checkbox from '@/components/shared/checkbox'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import { useState } from 'react'

/** Codes live only in component memory; never URL, storage or telemetry. */
export function RecoveryCodePanel({ codes, onContinue }: { codes: string[]; onContinue: () => void }) {
  const [saved, setSaved] = useState(false)
  return <AuthStack>
    <Notice tone="info" message="この画面を閉じると、コードはもう表示できません。安全な場所へ保存してください。" />
    <CodeBlock>{codes.join('\n')}</CodeBlock>
    <CopyTextButton aria-label="回復コードをコピー" value={codes.join('\n')} />
    <Checkbox checked={saved} onCheckedChange={setSaved}>回復コードを保存しました</Checkbox>
    <Button variant="primary" disabled={!saved} onClick={onContinue}>管理画面へ進む</Button>
  </AuthStack>
}

export default function RecoveryCodes(props: { codes: string[]; onContinue: () => void }) {
  return <AuthPage title="回復コードを保存" help="認証アプリを使えないときに入れます。それぞれ1回だけ使えます。"><RecoveryCodePanel {...props} /></AuthPage>
}
