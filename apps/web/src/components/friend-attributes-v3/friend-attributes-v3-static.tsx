import styles from './friend-attributes-v3-static.module.css'

const menuSections = [
  { label: null, items: ['ダッシュボード', '受信箱', '友だち', '友だち属性V3'] },
  { label: '配信', items: ['シナリオ配信', '一斉配信', 'リマインダ', '自動応答', '友だち追加時の配信', 'ウェビナー'] },
  { label: 'コンテンツ', items: ['テンプレート', 'リッチメニュー', '回答フォーム', '共通情報', '登録メディア一覧'] },
  { label: '成果と分析', items: ['成果とアフィリエイト', 'マイル', '流入と計測'] },
] as const

const folders = [
  ['すべて', '101', 'green'],
  ['VIP', '8', 'orange'],
  ['ペット', '6', 'pink'],
  ['会員', '8', 'emerald'],
  ['健康', '8', 'cyan'],
  ['購入', '9', 'blue'],
  ['未分類', '11', 'gray'],
] as const

const rows = [
  { tag: 'EC顧客連携済み', folder: '購入', folderTone: 'blue', count: '5人', source: 'EC連携', links: [['本人+10', 'green'], ['1.2倍', 'orange'], ['他1', 'gray']], usage: '配信3・フォーム1', date: '2026/01/11', star: '★ 一覧' },
  { tag: 'LINEログイン連携済み', folder: '会員', folderTone: 'emerald', count: '5人', source: 'LINE Login', links: [], usage: 'シナリオ2', date: '2026/01/13', star: '★ 一覧' },
  { tag: 'NEN会員', folder: '会員', folderTone: 'emerald', count: '5人', source: '回答フォーム', links: [['本人+10', 'green'], ['紹介+5', 'green'], ['1.5倍', 'orange'], ['他3', 'gray']], usage: '配信4', date: '2026/01/13', star: '—' },
  { tag: '商品到着確認対象', folder: '購入', folderTone: 'blue', count: '3人', source: 'EC購入', links: [['本人+3', 'green'], ['他1', 'gray']], usage: '自動応答1', date: '2026/01/13', star: '—' },
  { tag: '未契約', folder: '未分類', folderTone: 'gray', count: '3人', source: '手動', links: [], usage: '保存検索2', date: '2026/01/13', star: '★ 一覧' },
  { tag: '誕生日クーポン対象', folder: 'VIP', folderTone: 'orange', count: '0人', source: '誕生日ルール', links: [['本人+20', 'green'], ['他2', 'gray']], usage: '配信1', date: '2026/01/13', star: '—' },
] as const

function NavMark({ index }: { index: number }) {
  return <span className={styles.navMark} aria-hidden="true">{index < 4 ? ['◇', '▣', '♧', '◇'][index] : '•'}</span>
}

function StaticButton({ children, accent = false, compact = false }: { children: React.ReactNode; accent?: boolean; compact?: boolean }) {
  return <button type="button" className={`${styles.button} ${accent ? styles.buttonAccent : ''} ${compact ? styles.buttonCompact : ''}`}>{children}</button>
}

export default function FriendAttributesV3Static() {
  return (
    <div className={styles.screen} data-design-node="xn98K" data-design-version="friend-attributes-v3-static">
      <aside className={styles.sidebar} aria-label="V3確認用メニュー">
        <div className={styles.accountArea}>
          <p className={styles.accountLabel}>現在のLINEアカウント</p>
          <div className={styles.accountCard}>
            <span className={styles.accountLogo}>然</span>
            <span className={styles.accountText}><strong>然-NEN- TEST</strong><small>コミュニケーション</small></span>
            <span className={styles.chevron}>▾</span>
          </div>
        </div>
        <nav className={styles.navigation}>
          {menuSections.map((section, sectionIndex) => (
            <section key={section.label ?? 'basic'} className={styles.navSection}>
              {section.label && <h2>{section.label}</h2>}
              {section.items.map((item, itemIndex) => {
                const active = item === '友だち属性V3'
                return (
                  <div key={item} className={`${styles.navItem} ${sectionIndex > 0 ? styles.navItemCompact : ''} ${active ? styles.navItemActive : ''}`}>
                    <NavMark index={sectionIndex === 0 ? itemIndex : 5} />
                    <span>{item}</span>
                    {item === '受信箱' && <b className={styles.unread}>1</b>}
                  </div>
                )
              })}
            </section>
          ))}
        </nav>
        <footer className={styles.sidebarFooter}><strong>Kenta Kawano(Obama)</strong><span>管理者</span></footer>
      </aside>

      <main className={styles.main}>
        <div className={styles.page}>
          <header className={styles.header} data-design="Head">
            <div><h1>友だち属性</h1><p>タグ・情報欄・対応マーク・保存条件を、用途まで見ながら管理します。</p></div>
            <div className={styles.headerActions}><StaticButton>マニュアル</StaticButton><StaticButton>CSVで一括登録</StaticButton></div>
          </header>

          <div className={styles.tabs} data-design="Tabs">
            <span className={styles.tabActive}>タグ</span><span>友だち情報欄</span><span>対応マーク</span><span>保存した検索</span>
          </div>

          <section className={styles.kpis} data-design="KPIs">
            {[
              ['タグ数', '101件', '未使用 78件'],
              ['付与済み友だち', '5人', '1つ以上付与'],
              ['今月の付与', '78回', '手動・自動'],
              ['整理候補', '80件', '未使用・重複名'],
            ].map(([label, value, note]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}
          </section>

          <div className={styles.primaryActions} data-design="Actions"><StaticButton>フォルダを追加</StaticButton><StaticButton accent>＋ タグを追加</StaticButton></div>

          <section className={styles.workspace}>
            <aside className={styles.folderPanel} data-design="Folder">
              <div className={styles.folderTitle}><strong>フォルダ</strong><span>101件</span></div>
              <div className={styles.folderList}>
                {folders.map(([name, count, tone]) => (
                  <div key={name} className={name === 'すべて' ? styles.folderActive : ''}>
                    <span className={`${styles.dot} ${styles[tone]}`} /><span>{name}</span><b>{count}</b>
                  </div>
                ))}
              </div>
              <p className={styles.folderNote}>フォルダを削除しても、中の項目は未分類に残ります。</p>
            </aside>

            <div className={styles.listArea}>
              <div className={styles.toolbar} data-design="Toolbar">
                <div><StaticButton compact>タグ名・用途で検索</StaticButton><StaticButton compact>使用状態：すべて</StaticButton><StaticButton compact>付与元：すべて</StaticButton></div>
                <div className={styles.countControl}><StaticButton compact>20件表示</StaticButton><span>1〜20 / 101件</span></div>
              </div>
              <div className={styles.quickFilters} data-design="QuickFilters"><span>よく使う</span><b>未使用のタグ</b><i>今月増えたタグ</i><i>自動付与あり</i><i>連動あり</i><i>★一覧表示</i></div>

              <div className={styles.table} data-design="Table">
                <div className={`${styles.tableGrid} ${styles.tableHeader}`}><span /><span>タグ</span><span>フォルダ</span><span>付与人数</span><span>自動付与のもと</span><span>連動（マイル・アクション）</span><span>使用先</span><span>登録日</span><span>表示</span><span>操作</span></div>
                {rows.map((row) => (
                  <div className={`${styles.tableGrid} ${styles.tableRow}`} key={row.tag}>
                    <span className={styles.drag}>⠿</span><strong title={row.tag}>{row.tag}</strong>
                    <span className={styles.folderBadge}><i className={`${styles.dot} ${styles[row.folderTone]}`} />{row.folder}<small>⌄</small></span>
                    <span>{row.count}</span><span title={row.source}>{row.source}</span>
                    <span className={styles.linkBadges}>{row.links.length ? row.links.map(([label, tone]) => <b key={label} className={styles[tone]}>{label}</b>) : <em>—</em>}</span>
                    <span title={row.usage}>{row.usage}</span><span>{row.date}</span><span>{row.star}</span>
                    <span className={styles.rowActions}><b>編集</b><i>削除</i></span>
                  </div>
                ))}
              </div>
              <div className={styles.pagination} data-design="Pagination"><span>前へ</span><b>1</b><span>2</span><span>3</span><span>…</span><span>12</span><span>次へ</span></div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
