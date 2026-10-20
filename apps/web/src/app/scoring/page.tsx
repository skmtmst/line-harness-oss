import { permanentRedirect } from 'next/navigation'

/** 旧ブックマークを壊さず、管理画面のマイル正本へ移す。 */
export default function LegacyScoringPage() {
  permanentRedirect('/mileage')
}
