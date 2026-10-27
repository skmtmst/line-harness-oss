import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const FORM = readUiSource(join(HERE, 'broadcast-form.tsx'), 'utf8')

/**
 * 一斉配信の最終確認（設計 `FpgxH` 6-1-H ／ IDEA-06）の禁止の見張り。
 *
 * 予約は確認を通すこと・人数は配信前チェックの数だけを使うこと・未取得は「—」・
 * 確認に並べる項目・送信枠・計算時刻・重複配信・古い確認の解除・送っているあいだ押せないことは
 * broadcast-form-final-confirm-react.test.tsx と broadcast-form-send-flow.test.tsx が画面を押して、
 * 表示の値は broadcast-preflight-summary.test.ts が、送信後の行き先は
 * app/broadcasts/new/broadcast-new-success-route-react.test.tsx が見る。
 */
describe('一斉配信の最終確認', () => {
  it('対象画面の人数を、事前確認と別の口で数え直さない', () => {
    expect(FORM).not.toContain('api.segments.count(')
  })
})
