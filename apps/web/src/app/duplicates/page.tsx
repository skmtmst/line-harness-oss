'use client'

import Button from '@/components/shared/button'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { TableHeadRow, Th } from '@/components/shared/table'
import { TableStateRow } from '@/components/shared/table'
import { isForbidden } from '@/components/shared/api-error-message'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
import DuplicatesStatsNotice from './duplicates-stats-notice'
import DuplicatesV8 from './duplicates-v8'
import { CANDIDATE_PAGE_SIZE, formatRelative, useDuplicatesData } from './use-duplicates-data'
import { formatDateTime, formatNumber } from '@/lib/format'

export default function DuplicatesPage() {
  const theme = useAdminTheme()
  if (theme === 'v8') return <DuplicatesV8 />
  return <DuplicatesPageV7 />
}

function DuplicatesPageV7() {
  usePageTitle('重複検出')
  // 読み込み・絞り込み・再検出のロジックは use-duplicates-data.ts が正本。
  // ★V8 の画面（duplicates-v8.tsx）も同じ口を使う。
  const {
    data,
    loading,
    refreshing,
    error,
    statsFailure,
    candidates,
    candidateTotal,
    statusCounts,
    lowConfidenceCount,
    query,
    setQuery,
    status,
    setStatus,
    page,
    setPage,
    candidatesLoading,
    candidateError,
    candidateFailure,
    load,
    loadCandidates,
    detect,
    duplicateTotalText,
    duplicateDetail,
  } = useDuplicatesData()

  const candidatePageCount = Math.max(1, Math.ceil(candidateTotal / CANDIDATE_PAGE_SIZE))
  const rangeStart = candidateTotal === 0 ? 0 : (page - 1) * CANDIDATE_PAGE_SIZE + 1
  const rangeEnd = Math.min(page * CANDIDATE_PAGE_SIZE, candidateTotal)

  return (
    <div className="flex flex-col gap-4" data-duplicates-design="v4">
      <section className="rounded-card border border-hairline bg-canvas px-4 py-3 shadow-card">
        <p className="text-sm font-bold text-ink">重複の可能性を検出します。自動統合はしません。</p>
        <p className="mt-1 text-xs leading-5 text-ink-secondary">確定済みID・連携UID・メール／電話の一致は強い根拠、プロフィール画像や名前だけの一致は候補として表示します。確認後も元のLINE友だちデータは残ります。</p>
      </section>

      {/*
        ★V7 `x63W5x`：ページ全体の失敗はピンクの箱ではなく、一覧の場所の
        ListState error だけ出す（読み直す口つき）。素の16進・Tailwind赤もやめる。
      */}
      {loading && !data ? (
        <ListState kind="loading" title="重複候補を読み込んでいます" />
      ) : !data && !candidatesLoading && candidates.length === 0 && candidateError ? (
        <>
          {/*
            集計も候補一覧も両方読めなかったときだけ、1枚の失敗にする。
            どちらか一方が残っていれば下の枝でページを残し、
            失敗はその場所（集計欄・表の中）で出す（R598）。
            R598残件：候補一覧の取得自体に権限が無い（403）ときは汎用の
            通信失敗にせず、権限の案内にする。押しても直らない再試行は
            出さない（`error` を渡すと ListState が言い分ける）。
          */}
          {isForbidden(candidateFailure) ? (
            <ListState
              kind="error"
              error={candidateFailure ?? undefined}
              onRetry={() => load()}
            />
          ) : (
            <ListState
              kind="error"
              title="読み込めませんでした"
              description="通信が切れたか、サーバが応えませんでした。登録した内容は消えていません。"
              onRetry={() => load()}
            />
          )}
        </>
      ) : (
        <>
          {/* When a refresh fails but we still have a previous snapshot, show
              the error inline above the data instead of replacing the whole
              page — losing the dashboard for a transient 500 is worse than
              showing slightly stale numbers with a warning. */}
          {/*
            ★V7 `x63W5x`：補助の失敗（取り直しだけ落ちた）は、その場所に
            小さく1行だけ。素の Tailwind 黄色はやめ、読み直す口をつける。
            R598: 集計が無くても（!data）候補一覧は残し、集計の失敗は
            集計欄の1行で伝えて再試行する。
          */}
          {!data ? (
            <DuplicatesStatsNotice failure={statsFailure} onRetry={() => load()} />
          ) : (
            error && (
              /*
               * R598残件：取得済みの集計がある状態で取り直したら権限不足
               * （403）だったときは、汎用の再計算失敗にせず集計欄と同じ
               * 権限の案内にする。押しても直らない再試行は出さない。
               * 503などは従来どおり再試行を残す。
               */
              isForbidden(statsFailure) ? (
                <DuplicatesStatsNotice failure={statsFailure} onRetry={() => load()} />
              ) : (
                <p className="text-ink-secondary text-xs" role="status">
                  再計算できませんでした。表示中の数字は前回の集計です。
                  <button type="button" className="text-action ml-2 font-semibold hover:underline" onClick={() => load()}>もう一度</button>
                </p>
              )
            )
          )}
          {/*
            #1005: 独自カードをやめて共通 KpiCard の3段（見出し・数値・短い状態）に
            揃える。見積りの前提などの長い説明は説明アイコンの中へ移し、
            カード行を補足文の長さで伸ばさない。
          */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {/*
              FRIEND-11: 集計カードは読み込んだ1ページ分ではなく、同じ検索条件の
              全件を数えた statusCounts / lowConfidenceCount で出す。
              （読み込み50件で頭打ちにならない。）
            */}
            <KpiCard title="重複候補" value={null} unit="" valueText={duplicateTotalText} detail={duplicateDetail} />
            <KpiCard title="確認済み" value={null} unit="" valueText={statusCounts !== null ? `${formatNumber(statusCounts.linked ?? 0)}組` : '—'} detail={statusCounts !== null ? '' : '読み込めませんでした'} help="統合ユーザーに紐付け済みの組数です" />
            {/*
              friendDups は「重複した登録の行数」。送った通数ではない。
              以前はこれを「余分な配信回数」「1配信あたり浪費 ¥X」と言い切り、
              さらに設計にない「月10本配信なら」という前提まで作っていた。
              配信実績が繋がるまでは、数えられる行数だけを行数として出す。
            */}
            <KpiCard
              title="重複配信の削減"
              value={null}
              unit=""
              valueText="—"
              detail="配信実績の接続を待っています"
              description="配信前プレビューの実績を接続したあと、重複分を除いた削減の見込みをここに表示します。"
            />
            {/*
              R598: 集計が無いときは数値を「—」にし、3段目に読み込めなかった
              旨を出す（KpiCard の取得失敗の約束）。再試行の口は集計欄の
              1行に寄せ、同じ失敗の口を2つ出さない。
            */}
            {data ? (
              <KpiCard
                title="1配信あたりの無駄"
                value={null}
                unit=""
                valueText={`¥${formatNumber(data.wastedPerBroadcastYen)}`}
                detail={`¥${formatNumber(data.msgUnitYen)}/通の見積り`}
                description="重複している友だち登録の数に1通あたりの単価を掛けた見積りです。実際に送った配信の実績ではありません。"
              />
            ) : (
              <KpiCard
                title="1配信あたりの無駄"
                value={null}
                unit=""
                detail="読み込めませんでした"
                description="重複している友だち登録の数に1通あたりの単価を掛けた見積りです。実際に送った配信の実績ではありません。"
              />
            )}
            <KpiCard title="根拠不足" value={null} unit="" valueText={lowConfidenceCount !== null ? `${formatNumber(lowConfidenceCount)}組` : '—'} detail={lowConfidenceCount !== null ? '' : '読み込めませんでした'} help="名前・画像だけの候補です" />
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-secondary">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名前・メール・電話で検索" aria-label="名前・メール・電話で検索" className="h-10 min-w-60 rounded-control border border-hairline bg-canvas px-3 text-sm" />
              <Select
                aria-label="状態で絞り込む"
                label="状態"
                value={status}
                onChange={setStatus}
                options={[
                  { value: '', label: 'すべて' },
                  { value: 'pending', label: '未確認' },
                  { value: 'linked', label: '確認済み' },
                  { value: 'deferred', label: '保留' },
                  { value: 'different', label: '別人' },
                ]}
              />
            </div>
            <div className="flex items-center gap-3">
              {data?.computedAt && (
                <span className="text-xs text-ink-faint">
                  {formatRelative(data.computedAt)}に計算
                </span>
              )}
              <Button variant="secondary" className="h-9 px-3 text-xs text-ink-secondary hover:bg-surface-pearl disabled:opacity-50 whitespace-normal" type="button" onClick={() => void detect()} disabled={refreshing}>
                {refreshing ? '再検出中…' : '重複を再検出'}
              </Button>
            </div>
          </div>

          <section className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-card" aria-busy={candidatesLoading}>
            <table className="w-full table-fixed text-sm">
              <colgroup><col style={{ width: '17%' }}/><col style={{ width: '8%' }}/><col style={{ width: '24%' }}/><col style={{ width: '17%' }}/><col style={{ width: '11%' }}/><col style={{ width: '8%' }}/><col style={{ width: '15%' }}/></colgroup>
              {/*
                #984 LAY-12: 見出しは共通の TableHeadRow（高さ44px・
                背景・罫線を部品側で持つ）。セルの外付け余白で高さを
                作らない。ページ内のほかの表と同じ見出し規則にそろえる。
              */}
              <thead><TableHeadRow>{/* 表の外側の余白は見出しの余白（20px）にそろえ、操作は右へ寄せる。 */}<Th className="pl-5">候補</Th><Th>確信度</Th><Th>一致した根拠</Th><Th>所属アカウント</Th><Th>最終更新</Th><Th>状態</Th><Th align="right" className="pr-5">操作</Th></TableHeadRow></thead>
              <tbody className="divide-y divide-hairline">
                {candidateError ? (
                  <TableStateRow
                    colSpan={7}
                    kind="error"
                    title={candidateError}
                    onRetry={() => void loadCandidates()}
                    retryLabel="再試行"
                    error={candidateFailure ?? undefined}
                  />
                ) : candidatesLoading && candidates.length === 0 ? (
                  // FRIEND-12: 応答待ちを「0件」と見せない。
                  <TableStateRow colSpan={7} kind="loading" title="読み込んでいます…" />
                ) : candidates.length ? candidates.map((candidate) => (
                  <tr key={candidate.id}>
                    <td className="py-3 pr-3 pl-5 font-semibold text-ink" title={`${candidate.left.label} ↔ ${candidate.right.label}`}><span className="block truncate">{candidate.left.label} ↔ {candidate.right.label}</span></td>
                    <td className="px-3 py-3 text-ink-secondary">{candidate.confidence.label === 'very_high' ? '最高' : candidate.confidence.label === 'high' ? '高' : candidate.confidence.label === 'medium' ? '中' : '低'}</td>
                    <td className="truncate px-3 py-3 text-ink-secondary" title={candidate.evidenceSummary.join('・')}>{candidate.evidenceSummary.join('・') || '根拠を確認'}</td>
                    <td className="truncate px-3 py-3 text-ink-secondary" title={[candidate.left.lineAccountName, candidate.right.lineAccountName].filter(Boolean).join(' / ')}>{[candidate.left.lineAccountName, candidate.right.lineAccountName].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-3 py-3 text-ink-secondary">{formatDateTime(candidate.reviewedAt ?? candidate.detectedAt)}</td>
                    <td className="px-3 py-3 font-semibold text-ink">{candidate.status === 'pending' ? '未確認' : candidate.status === 'linked' ? '確認済み' : candidate.status === 'deferred' ? '保留' : '別人'}</td>
                    <td className="whitespace-nowrap py-2 pr-5 pl-3 text-right"><Button href={`/friends/identity-candidates?id=${encodeURIComponent(candidate.id)}`}>重複候補を確認</Button></td>
                  </tr>
                )) : <TableStateRow colSpan={7} kind="empty" title="条件に合う重複候補はありません" />}
              </tbody>
            </table>
            {/*
              #984 LAY-16: 0件のとき「範囲の先頭が末尾を越える表示」を出していた。
              件数が0なら「0組」だけ、検索で0件なら解除の導線を出す。
            */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-3 text-xs text-ink-faint">
              {/* FRIEND-12: 応待ちは「更新中」と明示し、前の条件の結果と誤認させない。 */}
              {candidatesLoading ? <span>更新中…</span> : null}
              {/*
                ★V7 `x63W5x`：同じ失敗を1画面に1つへ。表の中の TableStateRow error
                が出すので、件数の文と重ねない。
              */}
              {candidateError ? (
                <span>—</span>
              ) : candidateTotal === 0 && !candidatesLoading ? (
                '0組'
              ) : candidates.length === 0 && !candidatesLoading ? (
                <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                  検索条件に合う候補はありません
                  <button
                    type="button"
                    onClick={() => { setQuery(''); setStatus('') }}
                    className="font-semibold text-action hover:underline"
                  >
                    検索条件を解除する
                  </button>
                </span>
              ) : candidateTotal > 0 ? (
                <span>
                  {formatNumber(candidateTotal)}組中 {formatNumber(rangeStart)}〜{formatNumber(rangeEnd)}組
                </span>
              ) : null}
              {/* FRIEND-11: 51件目以降へ進めるページ送り。 */}
              <Pagination
                page={page}
                pageCount={candidatePageCount}
                onPageChange={setPage}
                disabled={candidatesLoading}
                ariaLabel="重複候補のページ"
              />
            </div>
          </section>

          {/*
            R598: 集計が無いときは内訳とマトリックスを出さない（母数が無いため）。
            候補一覧（上の表）は集計なしでも残す。
          */}
          {data ? (
          <>
          <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
            <h2 className="text-sm font-bold text-ink">アカウント別ブレイクダウン</h2>
            <p className="mt-1 text-xs text-ink-faint">どのアカウントに重複が偏っているかを見ます。</p>
            {data.perAccount.length === 0 ? (
              <p className="mt-3 text-sm text-ink-faint">アカウントが登録されていません。</p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-card border border-hairline bg-canvas shadow-card">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <TableHeadRow>
                      {/* 表の外側の余白は見出しの余白（20px）にそろえる。 */}
                      <Th className="pl-5">アカウント</Th>
                      <Th align="right">友だち数</Th>
                      <Th align="right">うち重複</Th>
                      <Th align="right" className="pr-5">重複率</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody className="divide-y divide-divider-soft bg-canvas text-ink-secondary">
                    {data.perAccount.map((row) => (
                      <tr key={row.accountId}>
                        <td className="py-4 pr-4 pl-5 font-semibold text-ink" title={row.accountName}><span className="block truncate">{row.accountName}</span></td>
                        <td className="px-4 py-4 text-right tabular-nums"><span>{formatNumber(row.friends)}</span></td>
                        <td className="px-4 py-4 text-right tabular-nums"><span>{formatNumber(row.dups)}</span></td>
                        <td className="py-4 pr-5 pl-4 text-right tabular-nums">
                          <span>{(row.dupRate * 100).toFixed(0)}%</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {data.perAccount.length >= 2 && data.pairwiseOverlap && (() => {
            // Bind the optional array to a local so the inner map closures
            // keep the non-undefined narrowing.
            const pairwise = data.pairwiseOverlap
            return (
            <section className="rounded-card border border-hairline bg-canvas p-4 shadow-card">
              <h2 className="text-sm font-bold text-ink">アカウント間 重複マトリックス</h2>
              <p className="mt-1 text-xs text-ink-faint">
                行アカウントの友だちのうち、列アカウントにも居る人数 （行のアカウントに対する割合）。
              </p>
              {/*
                列数が可変のため、末尾列の右余白だけは要素指定で付ける
                （16px。先頭列の pl-4 とそろえる）。
              */}
              <style>{`[data-duplicates-matrix] tr > :last-child { padding-right: 16px; }`}</style>
              <div data-duplicates-matrix className="mt-3 overflow-hidden rounded-card border border-hairline bg-canvas shadow-card">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <TableHeadRow>
                      {/* 表の外側の余白は見出しの余白（16px）にそろえる。 */}
                      <Th className="pl-4">行 \ 列</Th>
                      {data.perAccount.map((col) => (
                        <Th
                          key={col.accountId}
                          title={col.accountName}
                          align="right"
                          className="truncate pr-4"
                        >
                          {col.accountName}
                        </Th>
                      ))}
                    </TableHeadRow>
                  </thead>
                  <tbody className="divide-y divide-divider-soft bg-canvas text-ink-secondary">
                    {data.perAccount.map((row) => (
                      <tr key={row.accountId}>
                        <td title={row.accountName} className="py-4 pr-2 pl-4 font-semibold text-ink">
                          <span className="block truncate">{row.accountName}</span>
                        </td>
                        {data.perAccount.map((col) => {
                          if (row.accountId === col.accountId) {
                            return (
                              <td
                                key={col.accountId}
                                className="px-2 py-4 text-right text-ink-disabled"
                              >
                                <span>—</span>
                              </td>
                            )
                          }
                          const pair = pairwise.find(
                            (p) =>
                              p.fromAccountId === row.accountId &&
                              p.toAccountId === col.accountId,
                          )
                          const overlap = pair?.overlap ?? 0
                          const rate = row.friends > 0 ? overlap / row.friends : 0
                          return (
                            <td
                              key={col.accountId}
                              className="px-2 py-4 text-right tabular-nums"
                            >
                              {formatNumber(overlap)}{' '}
                              <span className="text-xs text-ink-faint">
                                ({(rate * 100).toFixed(0)}%)
                              </span>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            )
          })()}
          </>
          ) : null}
        </>
      )}
    </div>
  )
}
