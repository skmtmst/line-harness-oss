import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hqPage = readFileSync(join(here, 'page.tsx'), 'utf8')
const hqBrowser = readFileSync(join(here, 'account-browser-v8.tsx'), 'utf8')
const hqOpenPage = readFileSync(join(here, 'open', 'page.tsx'), 'utf8')

describe('HQ account create entry', () => {
  it('HQ page links to the general account flow', () => {
    // 登録口は板 `JKjsE` の左の列（一覧の部品）と、空のときの案内に置く。
    assert.match(hqPage, /href="\/accounts\/new"/)
    assert.match(hqBrowser, /href="\/accounts\/new"/)
    assert.match(hqBrowser, /アカウントを登録/)
    assert.doesNotMatch(hqPage, /restaurant-test\/stores\/new/)
    assert.doesNotMatch(hqBrowser, /restaurant-test\/stores\/new/)
  })

  it('HQ open page links to the general account flow', () => {
    assert.match(hqOpenPage, /href="\/accounts\/new"/)
    assert.match(hqOpenPage, /＋ ?LINEアカウントを登録する/)
    assert.doesNotMatch(hqOpenPage, /restaurant-test\/stores\/new/)
  })
})
