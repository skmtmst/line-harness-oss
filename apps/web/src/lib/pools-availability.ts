import { api } from './api'
import { loadFeatureVisibility } from './feature-visibility-cache'

/*
 * GET /api/traffic-pools の発行前判定（Issue #703）。
 *
 * 口は、見えるLINEアカウントのどこにも multi_store_hierarchy が
 * 有効でないと 403（FEATURE_DISABLED）を返す。403 の応答自体が
 * ブラウザの console error（Failed to load resource）になるため、
 * .catch() で握りつぶしても監査のノイズは消えない。発行しないことが
 * 唯一の対策なので、ここで「有効な場所が1つでもあるか」だけを先に見る。
 *
 * 使うのは 403 にならない口だけ（/api/line-accounts は core、
 * visibility は表示可否の read-model。どちらも毎画面で呼ばれている）。
 *
 * 判定できなければ「呼ぶ」（fail-open）。サーバが正本なので、
 * 競合・権限降格の瞬間は従来どおり FeatureDisabledGate が案内へ切り替える。
 * accounts が空のときも「呼ぶ」：試験の素朴な stub や取得失敗を
 * 「無効」と読み違えて機能を消さないため。
 */
export async function isPoolsFeatureAvailable(
  accountIds?: readonly string[] | null,
): Promise<boolean> {
  let ids = accountIds ? [...accountIds] : []
  if (ids.length === 0) {
    try {
      const res = await api.lineAccounts.list()
      if (!res.success) return true
      ids = res.data.map((account) => account.id)
    } catch {
      return true
    }
  }
  if (ids.length === 0) return true
  const states = await Promise.all(
    ids.map((id) =>
      loadFeatureVisibility(id).then(
        (res) => (res.success && res.data?.features?.['multi_store_hierarchy'] === true) as boolean,
        () => true,
      ),
    ),
  )
  // 1つでも on が分かれば呼ぶ。全部 off と確定したときだけ呼ばない。
  if (states.every((on) => on === false)) return false
  return true
}
