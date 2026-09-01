import { permanentRedirect } from 'next/navigation'

/** 旧ブックマークを壊さず、V6のマイル正本へ移す。 */
export default function LegacyScoringPage() {
  permanentRedirect('/mileage')
}
