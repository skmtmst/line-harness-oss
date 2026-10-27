import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const LIST_V8 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'list-v8.tsx'), 'utf8')

/*
 * 共通情報の削除の窓（板 xxKtW）の言葉（「差し替えて消す」「消さずに止める」「差し替え先」「どうしますか」）は
 * `src/v8/common-vars/list-delete.test.tsx`・`list.test.tsx` が窓を開いて確かめる。ここは古い言葉へ戻さない見張りだけ。
 */
describe('xxKtW 削除の窓の言葉', () => {
  it('差し替えの言葉を「削除」へ戻さない', () => {
    expect(LIST_V8).not.toContain('差し替えて削除')
  })
})
