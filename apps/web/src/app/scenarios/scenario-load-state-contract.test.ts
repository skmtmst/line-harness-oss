import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

/*
 * 読み込み失敗・読み直し・操作の失敗の動きは scenario-load-failure-wiring.test.tsx・
 * scenario-row-panel-react.test.tsx・v8/scenarios/list-counts-and-actions.test.tsx が描いて守る。
 * ここは API の内部の文をそのまま出す書き方へ戻さない禁止の見張りだけを残す。
 */
/* 完全切り替え：管理画面 の page.tsx は捨て、V8 の一覧（src/v8/scenarios/list.tsx・page.tsx が描く本体）を見る。 */
const PAGE = readFileSync(new URL('../../v8/scenarios/list.tsx', import.meta.url), 'utf8')

describe("管理画面 シナリオ一覧の読込状態", () => {
  it('読込失敗を空のシナリオ一覧として表示しない', () => {
    expect(PAGE).not.toContain("setError(res.error)")
  })
})
