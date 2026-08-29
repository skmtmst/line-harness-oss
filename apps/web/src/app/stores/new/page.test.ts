import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveStep } from './step'

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../../../components/app-shell.tsx', import.meta.url), 'utf8')
const hq = readFileSync(new URL('../../hq/page.tsx', import.meta.url), 'utf8')
const oldWizard = readFileSync(new URL('../../restaurant-test/stores/new/page.tsx', import.meta.url), 'utf8')
const manualLinks = readFileSync(new URL('../../../lib/manual-links.ts', import.meta.url), 'utf8')

describe('店舗アカウント追加フロー', () => {
  const ready = { choice: 'existing' as const, createdOfficial: false, apiEnabled: true, channelId: '123', channelSecret: 'secret', connected: null }

  it('完了前にdoneを直接開くとchooseへ戻す', () => {
    expect(resolveStep('done', ready)).toBe('choose')
  })

  it('チャネル情報なしでverifyを直接開くとcredentialsへ戻す', () => {
    expect(resolveStep('verify', { ...ready, channelId: '' })).toBe('credentials')
    expect(resolveStep('verify', { ...ready, channelSecret: '' })).toBe('credentials')
  })

  it('接続済みならシークレットを消去した後もverifyを表示する', () => {
    expect(resolveStep('verify', { ...ready, channelSecret: '', connected: {} })).toBe('verify')
  })

  it('接続済みならシークレットを消去した後もdoneを表示する', () => {
    expect(resolveStep('done', { ...ready, channelSecret: '', connected: {} })).toBe('done')
  })

  it('必要な操作を済ませた段階はそのまま表示する', () => {
    expect(resolveStep('create', { ...ready, choice: 'new' })).toBe('create')
    expect(resolveStep('api', ready)).toBe('api')
    expect(resolveStep('credentials', ready)).toBe('credentials')
    expect(resolveStep('verify', ready)).toBe('verify')
  })

  it('各段階で不足している直前の操作へ戻す', () => {
    expect(resolveStep('create', { ...ready, choice: null })).toBe('choose')
    expect(resolveStep('api', { ...ready, choice: null })).toBe('choose')
    expect(resolveStep('api', { ...ready, choice: 'new', createdOfficial: false })).toBe('create')
    expect(resolveStep('credentials', { ...ready, apiEnabled: false })).toBe('api')
    expect(page).toContain('if (step !== requestedStep) router.replace(`/stores/new?step=${step}`)')
  })

  it('下部バーは状態文と空きを等幅にし、ボタンの組を中央へ置く', () => {
    expect(page).toContain('justify-center gap-6')
    expect(page).toContain('flex-1 text-sm text-ink-secondary')
    expect(page).toContain('className="flex shrink-0 gap-3"')
    expect(page).toContain('className="flex-1" aria-hidden="true"')
  })

  it('枠なしの6画面を履歴を積まず切り替える', () => {
    expect(shell).toContain("pathname.startsWith('/stores/new')")
    expect(shell).toContain('<AuthGuard><AccountProvider>{children}</AccountProvider></AuthGuard>')
    for (const step of ['choose', 'create', 'api', 'credentials', 'verify', 'done']) expect(page).toContain(`'${step}'`)
    expect(page).toContain('router.replace(`/stores/new?step=${next}`)')
    expect(page).not.toContain('next/link')
  })

  it('新規を選んだ場合だけ作成手順へ進む', () => {
    expect(page).toContain("choice === 'new' ? 'create' : 'api'")
    expect(page).toContain("step === 'create'")
  })

  it('空のマニュアルURLは押せない案内を表示する', () => {
    expect(page).toContain('aria-disabled="true"')
    expect(page).toContain('マニュアルは準備中です')
    for (const key of ['chooseLineAccount', 'createOfficialAccount', 'chooseProvider', 'enableMessagingApi', 'findChannelCredentials', 'createLoginChannel', 'createLiffApp', 'friendImport']) {
      expect(manualLinks).toContain(`${key}: ''`)
    }
  })

  it('統括の2つの導線だけを新画面へ向け、旧画面を残す', () => {
    expect(hq.match(/href="\/stores\/new"/g)).toHaveLength(2)
    expect(oldWizard).toContain('NewRestaurantStorePage')
  })
})
