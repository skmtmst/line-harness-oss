import { readFileSync as readOwnFile } from 'node:fs'
import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
// ★V8 の登録は src/v8 に一から書いた（入口 new/page.tsx は @/v8 から読む）。新しい画面も一緒に読む。
const setupSource = readFileSync(join(directory, 'new/page.tsx'), 'utf8') + readFileSync(join(directory, '../../v8/account-new/register.tsx'), 'utf8')
const accountsSource = readFileSync(join(directory, '../../v8/settings/accounts/accounts.tsx'), 'utf8')

/*
 * D-3 店舗追加・一覧の統括集約。ここは「置かないもの」だけを文字で見張る。
 * 描いて確かめる側：
 *   - 一覧の板 V7vn3・並び替えは窓の中だけ: accounts-row-actions-react.test.tsx
 *   - 登録の5段と正本ノード: new/register-v8-react.test.tsx
 *   - 店舗追加ウィザードの5段・伏せ字の欄: v8/restaurant/store-new/store-new-steps.test.tsx
 *   - 階層編集の窓（a7lUk）: components/accounts/account-ordering-v8.test.tsx
 *   - 編集窓が秘密値を読まない・狭い画面の外枠: components/accounts/account-edit-modal.test.tsx
 */
describe('D-3 店舗追加・一覧の統括集約', () => {
  it('LINEアカウントの設定と登録は /accounts に置く（どこへも転送しない）', () => {
    /*
      2026-09-04: 転送を2つともやめた。**統括の店舗管理と、LINE公式アカウントの
      設定は別のもの**。**店舗を作ることと、アカウントを登録することも別**
      （要件 `管理画面-33-account-settings` §5-3）。
      `/hq` は統括向けの店舗管理として、店舗ウィザードは飲食店向けの入口として残す。
    */
    expect(accountsSource).not.toContain("redirect('/hq')")
    expect(setupSource).not.toContain("redirect('/restaurant-test/stores/new')")
  })

  it('登録に古い入力欄（トークン直入力・LIFF ID・タイムゾーン）を戻さない', () => {
    expect(setupSource).not.toContain('channel-access-token')
    expect(setupSource).not.toContain('id="liff-id"')
    expect(setupSource).not.toContain('account-timezone')
  })

  it('階層編集部品は、管理画面 の一覧（page.tsx 自身）からは開かない', () => {
    /*
      板  に並び順の操作は無いので、管理画面 の一覧（page.tsx 自身）からは外した。
      ★V8 の一覧は頭の「並び順と親子を変える」で窓を開く（描画の試験で押して確かめる）。
    */
    expect(readOwnFile(join(directory, 'page.tsx'), 'utf8')).not.toContain('AccountOrdering')
  })
})
