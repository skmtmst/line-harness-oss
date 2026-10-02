import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * モーダル窓の約束（R196・R218系・全ポップアップ共通ルール）の再発防止。
 *
 * 画面独自の `fixed inset-0` オーバーレイは、共通ダイアログと同じ約束
 * （Escapeで閉じる・Tabは窓の中で回る・開いたら窓の中へフォーカス・
 * 閉じたら起点へ戻す・背面はスクロールしない）を共通フック
 * `useOverlayFocus` で持つことを機械的に確認する。
 * モーダルではない `fixed inset-0`（メニューの背景・クリックで閉じるだけの
 * 層など）は EXEMPTIONS へ理由つきで分類する。未分類のままだとこの試験が落ちる。
 */

/** 画面独自の重なりの印。共通部品（Dialog/Drawer）はこの印を部品の中に持つ。 */
const OVERLAY_SIGNATURE = /fixed inset-0/

/** 共通の約束を持つ印。 */
const FOCUS_MANAGED_SIGNATURE = /useOverlayFocus/

/*
 * `fixed inset-0` はあるがフォーカス閉じ込めの対象ではないもの。
 * 理由を必ず書く。窓として管理できるようになったらここから消す。
 */
const EXEMPTIONS: Record<string, string> = {
  'components/ops/ops-shell.tsx':
    'モバイルのサイドメニュー背景（xl:hidden）。メニュー自体は別面の部品',
  'components/shared/folder-add-dialog.tsx':
    'Claude 領域（components/shared/）の窓。同じ約束への置き換えは対象スレッドで宣言してから別対応',
}

function* tsxFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* tsxFiles(path)
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      yield path
    }
  }
}

function overlayFiles(): string[] {
  const found: string[] = []
  for (const root of ['app', 'components']) {
    for (const path of tsxFiles(join(SRC, root))) {
      if (OVERLAY_SIGNATURE.test(readFileSync(path, 'utf8'))) {
        found.push(path.slice(SRC.length + 1))
      }
    }
  }
  return found.sort()
}

describe('画面独自のオーバーレイはフォーカス管理か理由つき対象外へ分類される契約', () => {
  it('`fixed inset-0` を持つ画面は useOverlayFocus か EXEMPTIONS のどちらか', () => {
    const unclassified = overlayFiles().filter((file) => {
      if (FOCUS_MANAGED_SIGNATURE.test(readFileSync(join(SRC, file), 'utf8'))) return false
      return !Object.hasOwn(EXEMPTIONS, file)
    })
    expect(
      unclassified,
      'モーダル窓が未分類です。useOverlayFocus で閉じる・フォーカス管理を持たせるか、' +
        'モーダルでない層なら理由を書いて EXEMPTIONS へ追加してください' +
        '（app/overlay-focus-wiring-contract.test.ts）',
    ).toEqual([])
  })
})
