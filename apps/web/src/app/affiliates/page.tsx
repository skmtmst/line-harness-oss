import { redirect } from 'next/navigation'

/**
 * 旧URLはV6正本へ集約する。
 *
 * ここに別のタイトル・タブ・状態を持つと、同じ紹介者機能を二重に直すことに
 * なる。画面名は共通トップバー、本文は /conversions の共通タブだけが持つ。
 */
export default function AffiliatesPage() {
  redirect('/conversions?tab=affiliates')
}
