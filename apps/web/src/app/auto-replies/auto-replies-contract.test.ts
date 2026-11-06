import { readUiSource } from '../../../scripts/test-ui-source.mjs'

import { describe, expect, it } from 'vitest'

const PUBLISH = readUiSource(new URL('../../v8/auto-replies/edit/wizard.tsx', import.meta.url), 'utf8')

/*
 * 動き（順番・公開前テスト・未取得の数・停止・複製・競合の説明）は
 * v8/auto-replies/list-behavior.test.tsx・edit/wizard-behavior.test.tsx が押して確かめる。
 * ここには飾りボタンを戻さない禁止の見張りだけを残す。
 */
describe("管理画面 自動応答一覧の契約", () => {
  it('onClick/href の無い飾りボタンを残さない', () => {
    expect(PUBLISH).not.toContain('<Button><PauseCircle')
  })
})
