import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('V6 友だち追加時配信の契約', () => {
  it('画面名とマニュアルはV6共通トップバーだけに置き、画面固有の操作は残す', () => {
    expect(PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(PAGE).not.toContain('title="友だち追加時の配信"')
    expect(PAGE).not.toContain('マニュアル')
    expect(PAGE).toContain('data-design="Head"')
    expect(PAGE).toContain('<TestRunButton accountId={accountId} scenarioName={scenarioName} />')
    expect(PAGE).toContain("{saving ? '保存中…' : '保存'}")
  })

  it('不完全な設定でも保存操作から理由を表示できる', () => {
    expect(PAGE).toContain('const problem = routingError()')
    expect(PAGE).toContain('setError(problem)')
    expect(PAGE).toContain('disabled={saving}')
    expect(PAGE).not.toContain("disabled={saving || routingError() !== ''}")
  })

  it('未選択のアカウントへ勝手に保存せず、切替前の応答も表示しない', () => {
    expect(PAGE).toContain('const accountId = selectedAccountId')
    expect(PAGE).not.toContain('selectedAccountId ?? accounts[0]')
    expect(PAGE).toContain('loadedAccountId !== accountId')
    expect(PAGE).toContain('activeAccountRef.current !== accountId')
  })

  it('読み込みと保存の通信失敗から再操作できる', () => {
    expect(PAGE).toContain('もう一度読み込む')
    expect(PAGE).toContain('保存できませんでした。通信を確認して、もう一度お試しください。')
    expect(PAGE).toContain('finally')
    expect(PAGE).toContain('setSaving(false)')
  })
})
