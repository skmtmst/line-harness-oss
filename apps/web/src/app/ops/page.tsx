import { redirect } from 'next/navigation'

/** /ops の入口。第 1 段では契約先アカウントへ。ダッシュボードは第 3 段。 */
export default function OpsIndexPage() {
  redirect('/ops/tenants')
}
