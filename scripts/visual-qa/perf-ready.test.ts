import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { auditReady, PerfNotReadyError, waitUntilReady } from './perf-ready.mjs'

/*
 * ROOT11: 速さの試験（perf-large.mjs）が「表示できていない状態」を記録しないこと。
 * 準備待ちの失敗は捨てずに投げ、監査の場面は「入った記録」のタブと行が出るまで測らない。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const PERF = readFileSync(join(HERE, 'perf-large.mjs'), 'utf8')

const pageReturning = (value: unknown) => ({
  waitForFunction: async () => ({ jsonValue: async () => value }),
})
const pageTimingOut = () => ({
  waitForFunction: async () => { throw new Error('Timeout 30000ms exceeded.') },
})

describe('準備待ち（waitUntilReady）', () => {
  it('準備できたら通す', async () => {
    await expect(waitUntilReady(pageReturning(true), '/staff', () => true)).resolves.toBeUndefined()
  })

  it('時間切れを捨てずに失敗にする', async () => {
    await expect(waitUntilReady(pageTimingOut(), '/staff', () => false)).rejects.toBeInstanceOf(PerfNotReadyError)
  })

  it('空データ・読み込み失敗は待たずに失敗にし、理由を残す', async () => {
    await expect(waitUntilReady(pageReturning('empty'), '/staff', () => 'empty')).rejects.toThrow('empty')
    await expect(waitUntilReady(pageReturning('error'), '/staff', () => 'error')).rejects.toThrow('error')
  })
})

type FakeNode = { textContent?: string; querySelector?: (s: string) => unknown; querySelectorAll?: (s: string) => unknown[] }
function fakeDocument({ tab, panelText, rows }: { tab: boolean; panelText?: string; rows?: number }) {
  const panel: FakeNode | null = panelText === undefined ? null : {
    textContent: panelText,
    querySelectorAll: () => Array.from({ length: rows ?? 0 }, () => ({ querySelector: () => ({}) })),
  }
  return {
    querySelector: (selector: string) => {
      if (selector.includes('aria-current')) return tab ? {} : null
      if (selector.includes('jwVlo')) return panel
      return null
    },
  }
}

describe('監査の場面の準備（auditReady）', () => {
  const g = globalThis as unknown as { document?: unknown }
  afterEach(() => { delete g.document })

  it('入った記録のタブで、記録の行が出たときだけ準備できたとする', () => {
    g.document = fakeDocument({ tab: true, panelText: 'Kenta 開く', rows: 20 })
    expect(auditReady()).toBe(true)
  })

  it('main だけ・ほかのタブ・読み込み中は準備できていない', () => {
    g.document = fakeDocument({ tab: false })
    expect(auditReady()).toBe(false)
    g.document = fakeDocument({ tab: true, panelText: '記録を読み込んでいます…', rows: 0 })
    expect(auditReady()).toBe(false)
  })

  it('空データと読み込み失敗を分けて返す', () => {
    g.document = fakeDocument({ tab: true, panelText: '条件に合う記録はありません。条件を変えてお試しください。' })
    expect(auditReady()).toBe('empty')
    g.document = fakeDocument({ tab: true, panelText: '入った記録を読み込めませんでした。' })
    expect(auditReady()).toBe('error')
  })
})

describe('perf-large.mjs の配線', () => {
  it('準備待ちの失敗を catch で捨てない', () => {
    expect(PERF).not.toMatch(/waitForFunction\([^)]*\)[^\n]*\.catch\(\(\) => \{\}\)/)
    expect(PERF).toContain('await waitUntilReady(page, path, waitFn)')
  })

  it('監査の場面は「入った記録」のタブを開き、auditReady で待つ', () => {
    expect(PERF).toContain("simplePage(browser, '/staff?tab=audit', auditReady, DOC_SCROLLER)")
  })

  it('準備できなかった場面があれば終わりの番号を 1 にする', () => {
    expect(PERF).toContain('if (result.failed.length > 0) process.exitCode = 1')
  })
})
