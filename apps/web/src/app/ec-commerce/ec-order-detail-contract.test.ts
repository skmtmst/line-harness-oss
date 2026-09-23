import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * IDEA-23「この注文の状況」の配線契約。
 *
 * 決めたこと:
 *  - 新しい画面・タブは増やさない。取り込みの記録の行から既存の Drawer で
 *    開く説明パネルだけを足す（親ECの注文台帳の複製はしない）。
 *  - パネルは注文IDとアカウントを束ねて GET /api/ec-commerce/orders/:id
 *    を読み、権限なし・読み込み失敗を別々に出す。
 *  - 「もう一度やる」は一覧と同じ retry を使い、成功済みの処理は重ねない。
 */
const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
const drawer = readFileSync(join(import.meta.dirname, 'order-detail-drawer.tsx'), 'utf8')
const api = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('IDEA-23 注文の状況パネルの配線', () => {
  it('新しいページやタブを増やさず、行からDrawerを開く', () => {
    expect(page).toContain("import OrderDetailDrawer from './order-detail-drawer'")
    expect(page).toContain("label: '注文の状況'")
    expect(page).toContain('setDetailSlot({ accountId, orderId: order.id })')
    // 詳細は既存の共有Drawerで開く（新しい画面骨組みは作らない）
    expect(drawer).toContain("import Drawer from '@/components/shared/drawer'")
  })

  it('詳細APIは注文IDとアカウントを束ねて渡す', () => {
    expect(api).toContain('/api/ec-commerce/orders/${encodeURIComponent(id)}?lineAccountId=')
    expect(drawer).toContain('api.ecCommerce.orderDetail(orderId, accountId)')
  })

  it('アカウント切替で別アカウントの注文を残さない', () => {
    expect(page).toContain('detailSlot.accountId === accountId')
    expect(page).toContain('onClose={() => setDetailSlot({ accountId, orderId: null })}')
  })

  it('権限なし・読み込み失敗・読み込み中を別の状態で出す', () => {
    for (const state of ["'loading'", "'forbidden'", "'error'", "'ready'"]) {
      expect(drawer).toContain(state)
    }
    expect(drawer).toContain('この注文の状況を見る権限がありません')
    expect(drawer).toContain('注文の状況を読み込めませんでした')
    // 古い返事で上書きしない（アカウント切替・連続オープンの両方で効く）
    expect(drawer).toContain('loadSeq.current')
  })

  it('再実行は一覧の retry を引き継ぎ、終わったら詳細を読み直す', () => {
    expect(page).toContain('onRetryAction={retry}')
    expect(drawer).toContain('await onRetryAction(action)')
    expect(drawer).toContain('await load(false)')
    // 二重実行しない約束を操作の隣に書く
    expect(drawer).toContain('重ねません')
  })

  it('生の配送エラーを出さず、台帳の分類を運用の言葉で出す', () => {
    expect(drawer).not.toContain('lastError')
    expect(drawer).toContain('FAILURE_KIND_TEXT')
    expect(drawer).toContain('止まった段階：')
  })
})
