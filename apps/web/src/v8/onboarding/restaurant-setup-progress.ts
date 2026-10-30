import { restaurantTestApi } from '@/lib/restaurant-test-api'
import type { StyleSetupProgress } from '@/v8/settings/public/getting-started-steps/index'

const keys = ['attributes', 'friendAdd', 'scenario', 'hours', 'followup'] as const
export function unknownRestaurantSetup(reason: string): StyleSetupProgress {
  return { style: 'restaurant', steps: Object.fromEntries(keys.map(key => [key, { complete: null, reason }])) }
}

/** 店舗を混ぜず、選ばれた1店舗だけを読む。前の店の値で未取得を補わない。 */
export async function loadRestaurantSetupProgress(accountId: string, selectedStoreId?: string | null): Promise<StyleSetupProgress> {
  let storeId = selectedStoreId
  if (storeId === undefined) {
    const [stores, context] = await Promise.all([restaurantTestApi.listStores(accountId), restaurantTestApi.storeContext(accountId)])
    if (!stores.success || !context.success) return unknownRestaurantSetup('店舗の設定を読み込めませんでした')
    const selected = context.data.selectedStore?.id
    const active = stores.data.stores.filter(store => store.status === 'active')
    const owned = active.filter(store => store.line_account_id === accountId)
    if (selected && owned.length > 0 && !owned.some(store => store.id === selected))
      return unknownRestaurantSetup('このアカウントの店舗を選んで設定を確認してください')
    storeId = selected ?? (owned.length === 1 ? owned[0].id : active.length === 1 ? active[0].id : null)
    if (storeId && !active.some(store => store.id === storeId)) return unknownRestaurantSetup('店舗の設定を確認できませんでした')
  }
  if (!storeId) return unknownRestaurantSetup('店舗を選んで設定を確認してください')
  const response = await restaurantTestApi.setupProgress(accountId, storeId)
  if (!response.success || response.data.storeId !== storeId
    || !['tables', 'hours', 'menus', 'reception', 'followup'].every(key => typeof response.data[key as keyof typeof response.data] === 'boolean'))
    return unknownRestaurantSetup('店舗の設定を読み込めませんでした')
  const data = response.data
  return { style: 'restaurant', steps: {
    attributes: { complete: data.tables, reason: '有効な卓と席を登録してください' },
    hours: { complete: data.hours, reason: '予約を受け付ける曜日と時間を設定してください' },
    friendAdd: { complete: data.menus, reason: 'コースとメニューを登録してください' },
    scenario: { complete: data.reception, reason: 'LINEの予約ページと、これからの受付枠を用意してください' },
    followup: followupEvidence(data.followupSetup, data.followup),
  } }
}

/** 新しい集計が来るまで現判定を保つ。表示のために保存や初期投入のGETを呼ばない。 */
export function followupEvidence(setup: unknown, fallback: boolean): {complete: boolean | null; reason: string} {
  if (setup === undefined) return {complete:fallback,reason:'来店フォローの内容と送信の設定を確認してください'}
  if (!setup || typeof setup !== 'object' || Array.isArray(setup))
    return {complete:null,reason:'来店フォローの状態を確認できませんでした'}
  const data = setup as Record<string,unknown>
  const valid = typeof data.notUsing === 'boolean' && typeof data.anyEnabled === 'boolean'
    && Number.isSafeInteger(data.version) && Number(data.version) >= 0
    && (data.decidedAt === null || typeof data.decidedAt === 'string' && Number.isFinite(Date.parse(data.decidedAt)))
    && (!data.notUsing || data.decidedAt !== null && Number(data.version) > 0)
  return valid ? {complete:data.notUsing === true || data.anyEnabled === true,reason:'来店フォローの送り方を1つ以上オンにするか、今は使わないことを保存してください'}
    : {complete:null,reason:'来店フォローの状態を確認できませんでした'}
}
