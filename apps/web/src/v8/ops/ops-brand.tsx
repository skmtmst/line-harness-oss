import SidebarIdentity from '@/components/layout/sidebar-identity'

/** 運営画面も共通メニューと同じ公式ロゴを使う。 */
export default function OpsBrand({ compact = false }: { compact?: boolean }) {
  return <SidebarIdentity compact={compact} />
}
