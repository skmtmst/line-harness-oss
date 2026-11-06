import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * 登録の口が一般の登録（/accounts/new）へ行くことは、描いて見る試験が守る：
 * hq-home-wiring-react（/hq）と open/hq-open-account-load-failure-react（/hq/open）。
 * ここは飲食の店舗作成へ戻さない禁止の見張りだけを残す。
 */
const here = dirname(fileURLToPath(import.meta.url))
const hqPage = readFileSync(join(here, '../../v8/hq/home.tsx'), 'utf8')
const hqOpenPage = readFileSync(join(here, 'open', 'page.tsx'), 'utf8')

describe('HQ account create entry', () => {
  it('HQ の登録口を飲食の店舗作成へ戻さない', () => {
    assert.doesNotMatch(hqPage, /restaurant-test\/stores\/new/)
    assert.doesNotMatch(hqOpenPage, /restaurant-test\/stores\/new/)
  })
})
