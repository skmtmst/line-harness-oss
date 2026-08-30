import { permanentRedirect } from 'next/navigation'

/** 旧ブックマークを壊さず、V6の「たまる決めごと」作成へ移す。 */
export default function LegacyScoringRulePage() {
  permanentRedirect('/mileage/earning-rules/new')
}
