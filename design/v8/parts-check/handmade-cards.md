# 手書きの共通部品候補（cards）

`rg -n` で app と機能別 components を検索。shared・layout・v8-parts・試験は除外。画面は変更していません。
生の入力、地と角丸を持つ案内、生のダイアログ、空の説明、骨格、LINEの独自枠を一覧化しました。候補には機能固有の表示も含みます。
列幅や段の構成を確認してから、画面担当が共通部品へ置き換えてください。共通部品を既に参照している行やimportだけの行は除いています。

## 選ぶ・チェックのカード

検索候補：65 行。

|場所|該当箇所（長い行は抜粋）|
|---|---|
| `apps/web/src/components/dashboard/dashboard-editor.tsx:203` | …ton variant="primary" className={(\`rounded-pill border px-2.5 py-1 text-nano font-medium ${device === key ? 'border-accent-deep bg-accent-deep text-on-accent' : 'border-hairline bg-canvas text-ink-secondary'}\`) + ' h-aut… |
| `apps/web/src/components/broadcasts/broadcast-asset-manager.tsx:195` | …) => <div key={card.id} className="rounded-card border bg-surface-pearl p-4"><div className="mb-3 flex justify-between"><b className="text-sm">パネル {index + 1}</b><button disabled={cards.length === 1} onClick={() => setCa… |
| `apps/web/src/components/broadcasts/broadcast-asset-manager.tsx:199` | …<article key={item.id} className="rounded-card border border-hairline bg-canvas p-5 shadow-card"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="rounded-pill bg-accent-s… |
| `apps/web/src/app/reminders/wizard-v8-ui.tsx:274` | type="radio" |
| `apps/web/src/app/rich-menus/new/create-v8.tsx:1691` | role="radio" |
| `apps/web/src/app/rich-menus/new/create-v8.tsx:1741` | role="radio" |
| `apps/web/src/components/scenarios/scenario-dialogs.tsx:936` | …iv className="border-hairline mt-5 rounded-panel border p-5"><h3 className="font-semibold">テスト対象</h3><dl className="mt-4 space-y-4 text-sm"><div className="flex justify-between"><dt className="text-ink-faint">LINEアカウント</… |
| `apps/web/src/components/scenarios/scenario-dialogs.tsx:941` | …4"><div className="border-hairline rounded-panel border p-5"><h3 className="font-medium">設定サマリー</h3><p className="text-ink-faint mt-1 text-xs">テスト送信の内容を確認します。選んだ相手のLINEへ実際に届きます。</p><dl className="mt-4 space-y-3 text-sm">… |
| `apps/web/src/components/scenarios/scenario-dialogs.tsx:966` | …d-confirm-title" className="w-full rounded-panel shadow-float" style={{ maxWidth: 672, background: 'var(--color-canvas)' }}><div className="border-hairline border-b px-6 py-5"><h2 id="test-send-confirm-title" className="… |
| `apps/web/src/app/friend-add-settings/editor-v8.tsx:612` | role="radio" |
| `apps/web/src/app/friend-add-settings/editor-v8.tsx:626` | role="radio" |
| `apps/web/src/app/friend-add-settings/editor-v8.tsx:687` | role="checkbox" |
| `apps/web/src/app/friend-add-settings/editor-v8.tsx:936` | role="checkbox" |
| `apps/web/src/app/friend-add-settings/editor-v8.tsx:1034` | role="radio" |
| `apps/web/src/app/friend-add-settings/editor-v8.tsx:1076` | role="radio" |
| `apps/web/src/app/rich-menus/external-import.tsx:126` | …3 grid grid-cols-3 overflow-hidden rounded-control border" style={{ aspectRatio: \`${selected.size.width} / ${selected.size.height}\` }}> |
| `apps/web/src/app/rich-menus/external-import.tsx:133` | <li key={\`${selected.richMenuId}-${index}\`} className="border-hairline grid grid-cols-[24px_minmax(0,1fr)] gap-2 rounded-control border p-2"> |
| `apps/web/src/app/contents/vars/new/new-v8.tsx:501` | role="radio" |
| `apps/web/src/app/nen-members/photo-review-v8.tsx:565` | …n key={reason.value} type="button" role="radio" aria-checked={reasonCode === reason.value} className={styles.pill} onClick={() => { setReasonCode(reason.value); setReasonError('') }}> |
| `apps/web/src/app/nen-members/photo-review-v8.tsx:883` | …n key={reason.value} type="button" role="radio" aria-checked={reasonCode === reason.value} className={styles.pill} onClick={() => { onReasonCode(reason.value); onReasonNote(reason.value === 'other' ? '' : reason.message)… |
| `apps/web/src/app/reminders/edit/issue469-reminder-screens.tsx:266` | …xtInput className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" type="number" min={-525600} max={525600} value={String(-(selectedStep.offsetMinutes ?? 0))} o… |
| `apps/web/src/app/reminders/edit/issue469-reminder-screens.tsx:271` | …xtInput className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus:outline-none" type="number" min={-365} max={365} value={String(-(selectedStep.offsetDays ?? 0))} onChange={… |
| `apps/web/src/app/reminders/edit/issue469-reminder-screens.tsx:275` | …xtInput className="border-hairline rounded-control focus:ring-accent min-w-24 border px-3 py-2 text-sm focus:ring-2 focus:outline-none" value={selectedStep.sendAtTime ?? ''} placeholder="HH:MM" onChange={(event) => updat… |
| `apps/web/src/app/reminders/edit/issue469-reminder-screens.tsx:283` | …Field label="本文" required note={\`${selectedStep.messageContent.length} / 5,000文字\`}><TextArea ref={bodyRef} rows={3} className="border-hairline rounded-control focus:ring-accent border px-3 py-2 text-sm focus:ring-2 focus… |
| `apps/web/src/components/friend-fields/support-mark-rules-panel.tsx:330` | role="radio" |
| `apps/web/src/app/contents/vars/list-v8.tsx:1683` | role="radio" |
| `apps/web/src/app/contents/vars/list-v8.tsx:1728` | role="radio" |
| `apps/web/src/components/friend-fields/tag-editor-v4.tsx:136` | …className={\`relative h-7 w-12 rounded-pill transition-colors ${checked ? 'bg-accent' : 'bg-hairline'}\`} |
| `apps/web/src/components/friend-fields/tag-editor-v4.tsx:138` | …className={\`absolute top-1 h-5 w-5 rounded-pill bg-canvas shadow-card transition-all ${checked ? 'left-6' : 'left-1'}\`} /> |
| `apps/web/src/components/friend-fields/tag-editor-v4.tsx:215` | …n variant="secondary" className={(\`rounded-control border px-3 py-3 text-left text-sm font-medium ${allowedActionTypes && !allowedActionTypes.includes(action[0]) ? 'cursor-not-allowed border-hairline text-ink-faint opaci… |
| `apps/web/src/components/friend-fields/tag-editor-v4.tsx:251` | …<><Combobox aria-label={\`${selected[0]}に使う内容を選択\`} placeholder={unavailable ? 'この種類は配布先で設定してください' : resources ? \`${selected[1]}を選択\` : '選択肢を読み込み中…'} value={resourceId} onChange={setResourceId} disabled={unavailable… |
| `apps/web/src/app/webinars/edit/cta-v8.tsx:282` | …iv className="border-hairline mt-3 rounded-control border p-3 text-sm"><p>保存されている申込フォーム：{latestEditor.publicPage.form?.name ?? (latestEditor.registrationFormId ? publishedForms.find((form) => form.id === latestEditor.reg… |
| `apps/web/src/components/support/support-inbox.tsx:391` | <p className="mt-4 rounded-card bg-canvas px-4 py-3 text-sm text-ink shadow-card">{selected.preview}</p> |
| `apps/web/src/components/support/support-inbox.tsx:392` | …variant="primary" className="mt-6 rounded-card px-6 py-3 font-bold shadow-card hover:brightness-90 border-0 h-auto whitespace-normal" href={\`/chats?friend=${encodeURIComponent(selected.threadId)}&unanswered=1\`}>LINEで返信す… |
| `apps/web/src/components/forms/hq-form-definition-editor.tsx:227` | …ck={() => moveBlock(-1)} disabled={selectedIndex < 0} className="rounded-control px-2 py-1 text-xs disabled:opacity-40">上に移動</button><button type="button" onClick={() => moveBlock(1)} disabled={selectedIndex < 0} classNa… |
| `apps/web/src/components/forms/hq-form-definition-editor.tsx:228` | …onClick={duplicateBlock} disabled={selectedIndex < 0} className="rounded-control px-2 py-1 text-xs disabled:opacity-40">複製</button><button type="button" onClick={removeBlock} disabled={selectedIndex < 0} className="round… |
| `apps/web/src/components/forms/hq-form-definition-editor.tsx:232` | …locks.length === 0 ? <p className="rounded-card border border-dashed border-hairline bg-canvas p-8 text-center text-sm text-ink-faint">「ブロックを追加」から作ってください</p> : blocks.map((block, index) => <BlockEditor key={block.id} blo… |
| `apps/web/src/app/booking/bookings/page.tsx:1617` | …lassName="text-danger bg-danger-bg rounded-mini px-3 py-1 text-xs font-medium hover:bg-status-danger-selected" |
| `apps/web/src/components/forms/options-sections.tsx:31` | return <Checkbox checked={checked} onCheckedChange={onChange} description={note} className="rounded-control border border-hairline p-3">{label}</Checkbox> |
| `apps/web/src/components/forms/options-dialog.tsx:172` | return <Checkbox checked={checked} onCheckedChange={onChange} description={note} className="rounded-control border border-hairline p-3">{label}</Checkbox> |
| `apps/web/src/app/nen/pets/pets-v8.tsx:853` | role="radio" |
| `apps/web/src/components/chats/template-picker.tsx:468` | …className={\`w-full rounded-control border px-3 py-3 text-left ${inPack \|\| (!packMode && selected?.id === template.id) ? 'border-accent-border bg-accent-soft' : 'border-shell-gray bg-canvas hover:bg-canvas… |
| `apps/web/src/components/chats/template-picker.tsx:527` | …<div className="mt-4 max-w-[78%] rounded-card rounded-tl-mini bg-canvas px-4 py-3 text-sm leading-6 whitespace-pre-wrap text-ink-secondary shadow-card">{previewContent ?? selected.messageContent}</div> |
| `apps/web/src/app/tags/search-editor-v8.tsx:816` | if (!selectedAccountId) return <p className="rounded-card border border-hairline bg-canvas p-5 text-sm text-ink-secondary">上部でLINE公式アカウントを選んでください。</p> |
| `apps/web/src/app/nen-campaigns/edit/campaign-editor.tsx:385` | …<section className="bg-canvas rounded-card border-hairline border p-4"><h2 className="text-sm font-medium">つながる先</h2><dl className="mt-3 space-y-2 text-xs"><div className="flex justify-between gap-3"><dt className="… |
| `apps/web/src/app/tags/searches/edit/page.tsx:817` | if (!selectedAccountId) return <p className="rounded-card border border-hairline bg-canvas p-5 text-sm text-ink-secondary">上部でLINE公式アカウントを選んでください。</p> |
| `apps/web/src/components/chats/template-folder-select.tsx:95` | …min-h-9 w-full items-center gap-2 rounded-mini px-2.5 py-1.5 text-left text-caption ${selectedOption ? 'bg-accent-soft font-medium text-accent-deep' : 'font-medium text-ink hover:bg-canvas-sunken'}\`} |
| `apps/web/src/app/tags/field-editor-v8.tsx:81` | role="radio" |
| `apps/web/src/app/tags/field-editor-v8.tsx:97` | role="radio" |
| `apps/web/src/app/tags/fields/edit/page.tsx:301` | if (!selectedAccountId) return <p className="rounded-card border border-hairline bg-canvas p-5 text-sm text-ink-secondary">上部でLINE公式アカウントを選んでください。</p> |
| `apps/web/src/app/tags/edit-field-page-v8.tsx:187` | if (!selectedAccountId) return <p className="rounded-card border border-hairline bg-canvas p-5 text-sm text-ink-secondary">上部でLINE公式アカウントを選んでください。</p> |
| `apps/web/src/app/staff/page.tsx:542` | }} className={\`rounded-control border p-3 text-left ${selectedBundle === value ? 'border-accent bg-accent-soft' : 'border-divider-soft bg-canvas'} ${writable ? '' : 'cursor-not-allowed opacity-60'}\`}><span clas… |
| `apps/web/src/app/staff/page.tsx:548` | …section className="overflow-hidden rounded-card border border-hairline bg-canvas"><div className="px-4 py-4"><h2 className="text-base font-bold text-ink">項目ごとに決める</h2><p className="mt-1 text-xs text-ink-faint">「変えられる」「見え… |
| `apps/web/src/app/staff/page.tsx:626` | …-y divide-hairline overflow-hidden rounded-card border border-hairline">{NOTIFICATIONS.map(([key, label, note]) => <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 p-3"><div><p className="text-… |
| `apps/web/src/app/staff/new/page.tsx:155` | …e="divide-hairline overflow-hidden rounded-card border border-hairline divide-y">{NOTIFICATIONS.map(([key, label, note]) => <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-5 px-4 py-3"><div><p c… |
| `apps/web/src/app/restaurant-test/stores/new/page.tsx:240` | <Checkbox checked={officialAccountReady} onCheckedChange={setOfficialAccountReady} className="rounded-control border border-hairline px-4 py-3">LINE公式アカウントを作成済みです</Checkbox> |
| `apps/web/src/app/emergency/page.tsx:1342` | <section className="rounded-control border border-danger bg-danger-bg p-4 text-danger"><p className="text-sm font-semibold">{accountName}</p><div className="mt-3 divide-y divide-danger/15">{selectedTargets.ma… |
| `apps/web/src/app/emergency/page.tsx:1605` | …items-center justify-between gap-2 rounded-control px-4 py-3 text-xs font-semibold text-warning" role="alert"><p>アカウント一覧を取得できませんでした。個別のアカウントを選べず、全体が対象になります。</p><button type="button" onClick={() => loadAccounts()} classNa… |
| `apps/web/src/app/restaurant-test/google/google-profile.tsx:583` | …={\`flex flex-col items-start gap-1 rounded-control border px-2 py-1.5 text-left text-label disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'text-on-accent border-transparent font-medium' : s \|\| changed ? 'bg… |
| `apps/web/src/app/chats/page.tsx:2658` | role="radio" |
| `apps/web/src/app/events/change-review/change-review-v8.tsx:207` | type="radio" |
| `apps/web/src/app/ops/support/page.tsx:577` | …className={\`block w-full rounded-card border bg-canvas p-3 text-left ${selected ? 'border-accent-deep bg-accent-soft' : 'border-hairline'}\`} |
| `apps/web/src/app/scenarios/mode/page.tsx:553` | <label className={\`rounded-card flex h-full cursor-pointer flex-col border bg-canvas p-5 ${selected ? 'border-accent bg-accent-soft' : 'border-hairline'} ${disabled ? 'cursor-not-allowed opacity-60' : ''}\`}> |
| `apps/web/src/app/scenarios/mode/page.tsx:555` | type="radio" |
| `apps/web/src/app/scenarios/mode-v8.tsx:534` | type="radio" |

## 知らせ・案内・ふきだし

検索候補：323 行。

|場所|該当箇所（長い行は抜粋）|
|---|---|
| `apps/web/src/components/reminders/reminder-publish-flow.tsx:410` | …ame="text-center"><span className="bg-success-bg text-success mx-auto grid h-10 w-10 place-items-center rounded-pill text-xl">✓</span><h2 className="text-ink mt-3 text-base font-bold">リマインダを有効化しました</h2><p className="text… |
| `apps/web/src/app/analytics/page.tsx:756` | …ne border p-8 text-center text-sm" role="status"> |
| `apps/web/src/app/analytics/page.tsx:880` | …ne border p-8 text-center text-sm" role="status"> |
| `apps/web/src/app/analytics/page.tsx:903` | …ne border p-8 text-center text-sm" role="status"> |
| `apps/web/src/app/analytics/page.tsx:1630` | …arning mt-2 text-xs font-semibold" role="status"> |
| `apps/web/src/app/analytics/page.tsx:1643` | …ssName="text-warning mt-2 text-xs" role="status">{usageNotice}</p>} |
| `apps/web/src/app/analytics/page.tsx:1647` | …arning mt-2 text-xs font-semibold" role="status"> |
| `apps/web/src/app/analytics/page.tsx:2293` | …className="v8-ro-analytics-state" role="status"><p>{reasonShownInBanner ? (METRIC_STATE_TEXT[overview.state] \|\| '未取得') : pendingReason}</p>{overview.state === 'pending' && <p>日ごとの集計は数分ごとに自動で更新されます。しばらくしても変わらないときは、時間をおいて… |
| `apps/web/src/app/analytics/page.tsx:3272` | …assName="v8-ro-analytics-readOnly" role="status">閲覧のみです。分析・CSVの書き出しはできます。作成や変更はできません。</div>} |
| `apps/web/src/components/events/event-form.tsx:431` | <div className="bg-status-warn-soft border border-status-warn rounded-control p-3 mb-4 text-xs text-status-warn-deep"> |
| `apps/web/src/components/events/event-form.tsx:437` | <div className="bg-status-warn-soft border border-status-warn rounded-control p-3 mb-4 text-xs text-status-warn-deep"> |
| `apps/web/src/app/reminders/list-v8.tsx:813` | <span className="sr-only" role="status" aria-live="polite"> |
| `apps/web/src/app/reminders/list-v8.tsx:1114` | <p className="border-info bg-info-bg text-ink rounded-control border px-3 py-2 text-sm" data-design-node="a5C1p"> |
| `apps/web/src/components/friends/friend-list-row.tsx:111` | className={\`rounded-mini p-1 ${attention ? 'text-status-warn-deep' : 'text-ink-faint'} hover:bg-status-warn-soft hover:text-status-warn-deep\`} |
| `apps/web/src/components/friends/friend-list-row.tsx:304` | className={\`rounded-mini p-1 pt-1.5 ${attention ? 'text-status-warn-deep' : 'text-ink-faint'} hover:bg-status-warn-soft hover:text-status-warn-deep\`} |
| `apps/web/src/components/friends/bulk-operation-editor.tsx:85` | …dsAccount && !accountId) return <p role="status" className="text-xs text-ink-secondary">操作するLINEアカウントを選んでください。</p> |
| `apps/web/src/components/root-landing-gate.tsx:43` | …-h-64 items-center justify-center" role="status" aria-label="表示先を確認中"> |
| `apps/web/src/components/hq/account-menu.tsx:204` | …line-flex h-4.5 w-fit items-center rounded-pill bg-status-warn-soft px-2 text-nano font-medium text-status-warn-deep' |
| `apps/web/src/components/hq/account-menu.tsx:206` | …line-flex h-4.5 w-fit items-center rounded-pill bg-status-danger-soft px-2 text-nano font-medium text-danger' |
| `apps/web/src/app/page.tsx:1728` | …sName="text-ink-secondary text-xs" role="status"> |
| `apps/web/src/components/tenant-suspended.tsx:17` | …ta-design-node="R7p6Ba" className="rounded-control border border-status-danger bg-status-danger-soft px-6 py-5 text-left"> |
| `apps/web/src/components/chats/inbox-kpis.tsx:60` | <span className="bg-status-danger-soft text-status-danger flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-pill" aria-hidden="true"> |
| `apps/web/src/app/accounts/migration.tsx:296` | {message && <p role="status" className="text-ink-secondary mt-3 text-sm">{message}</p>} |
| `apps/web/src/app/accounts/migration.tsx:615` | {detailBusy && <p role="status" className="text-ink-faint border-hairline border-b px-4 py-2 text-xs">対応表を読み込んでいます…</p>} |
| `apps/web/src/components/auto-replies/edit-dialog.tsx:1096` | <p role="status" className="text-ink-secondary mt-1 text-micro"> |
| `apps/web/src/app/staff/page.tsx:523` | …text-xs font-medium text-success" role="status">{copyNotice}</p>}</section>} |
| `apps/web/src/app/staff/page.tsx:620` | …er">{error}</p>}{emailNotice && <p role="status" className="mt-4 rounded-control bg-accent-soft p-3 text-sm text-accent-deep">{emailNotice}</p>} |
| `apps/web/src/app/staff/page.tsx:652` | …ード" className="h-[220px] w-[220px] rounded-control border border-hairline" /> : <DelayedSkeleton loading skeleton={<Skeleton width={220} height={220} className="block rounded-control" />} />}<div><h3 className="font-semi… |
| `apps/web/src/app/staff/page.tsx:653` | …saving} /></div><p className="mt-4 rounded-control bg-info-bg p-3 text-xs text-ink-secondary">登録後はLINEログインのあとに認証アプリのコード入力が必要です。</p> |
| `apps/web/src/app/accounts/new/page.tsx:419` | <p role="status" className="mb-2 text-center text-caption text-ink-secondary"> |
| `apps/web/src/components/chats/template-picker.tsx:522` | …=== 'frequent' && <span className="rounded-control border border-status-warn bg-status-warn-soft px-2.5 py-1.5 text-xs font-semibold text-status-warn-deep">☆ よく使う</span>} |
| `apps/web/src/components/inflow-links/site-script-v8.tsx:316` | …<p className={styles.cardNote} role="status"> |
| `apps/web/src/components/scenarios/scenario-dialogs.tsx:949` | …<div className="bg-info-bg mt-1 whitespace-pre-wrap rounded-panel p-4 text-sm"> |
| `apps/web/src/components/ops/impersonation-bar.tsx:89` | role="status" |
| `apps/web/src/components/ops/impersonation-bar.tsx:115` | role="status" |
| `apps/web/src/components/inflow-links/site-script.tsx:310` | <section className="rounded-card border border-success-bg bg-success-bg p-4" aria-label="いま届いているか"> |
| `apps/web/src/components/inflow-links/site-script.tsx:397` | …eading-relaxed text-ink-secondary" role="status"> |
| `apps/web/src/components/inflow-links/site-script.tsx:576` | <section className="rounded-card border border-status-warn bg-status-warn-soft p-5"> |
| `apps/web/src/app/accounts/uid-migration-v8.tsx:153` | …<div className={styles.infoBand} role="note"> |
| `apps/web/src/app/accounts/uid-migration-v8.tsx:201` | {message && <p role="status" className={styles.sectionDesc} style={{ marginTop: 8 }}>{message}</p>} |
| `apps/web/src/app/accounts/uid-migration-v8.tsx:436` | {detailBusy && <p role="status" className={styles.sectionDesc}>対応表を読み込んでいます…</p>} |
| `apps/web/src/app/accounts/uid-migration-v8.tsx:529` | …<p className={styles.sectionDesc} role="note">{executeBlockedReason}</p> |
| `apps/web/src/app/duplicates/duplicates-v8.tsx:122` | …<p className={styles.infoBand} role="status"> |
| `apps/web/src/components/hq/banners/image-detail-modal.tsx:255` | …line-flex h-9 items-center gap-1.5 rounded-control px-3 text-label font-semibold text-danger hover:bg-status-danger-soft disabled:opacity-50" |
| `apps/web/src/components/hq/banners/limit-state.tsx:30` | …<div data-design-node="oaFjL" role="status" className="flex flex-col items-start gap-2 rounded-card bg-status-warn-soft p-4"> |
| `apps/web/src/components/hq/banners/limit-state.tsx:46` | role="status" |
| `apps/web/src/components/hq/banners/limit-state.tsx:47` | …="flex flex-col items-center gap-3 rounded-card bg-status-warn-soft px-6 py-8 text-center" |
| `apps/web/src/app/duplicates/page.tsx:121` | …sName="text-ink-secondary text-xs" role="status"> |
| `apps/web/src/components/scenarios/trigger-editor.tsx:411` | <div className="bg-info-bg rounded-card mt-5 p-4"> |
| `apps/web/src/components/ops/ops-shell.tsx:246` | …ame="text-nano text-ink-secondary" role="status"> |
| `apps/web/src/components/hq/banners/generation-panel.tsx:349` | …<span className="block h-full rounded-pill bg-success" style={{ width: \`${pct}%\` }} /> |
| `apps/web/src/components/ops/notice-line-account-card.tsx:63` | {notice ? <p role="status" className="text-caption text-accent-deep">{notice}</p> : null} |
| `apps/web/src/app/duplicates/duplicates-stats-notice.tsx:20` | …sName="text-ink-secondary text-xs" role="status"> |
| `apps/web/src/app/affiliates/tabs.tsx:1034` | …<div className="bg-success-bg rounded-control p-4 border border-hairline"> |
| `apps/web/src/app/affiliates/tabs.tsx:1085` | …-flex items-center gap-1 px-2 py-1 bg-status-warn-soft border border-status-warn rounded-mini text-xs text-status-warn-deep" |
| `apps/web/src/app/affiliates/tabs.tsx:2634` | …d border-hairline mt-3 border p-4" role="status" aria-label="まとめて処理の結果"> |
| `apps/web/src/app/accounts/handover/page.tsx:429` | <p className="bg-info-bg text-ink-secondary rounded-control mb-4 px-4 py-3 text-xs leading-relaxed"> |
| `apps/web/src/app/accounts/handover/page.tsx:491` | <p className="bg-info-bg text-ink-secondary rounded-control px-4 py-3 text-xs leading-relaxed"> |
| `apps/web/src/app/accounts/handover/page.tsx:503` | ? 'bg-success text-on-accent flex size-7 shrink-0 items-center justify-center rounded-pill text-xs font-medium' |
| `apps/web/src/app/notifications/page.tsx:269` | …e="v8-ro-notifications-readNotice" role="status">未読のお知らせはありません。</p> : null} |
| `apps/web/src/app/affiliates/new-affiliate-v8.tsx:542` | …<p className="af-create-footnote" role="status">{saveNote}</p> : null} |
| `apps/web/src/app/accounts/handover/handover-v8.tsx:451` | <p className="bg-info-bg text-ink-secondary rounded-control px-4 py-3 text-xs leading-relaxed"> |
| `apps/web/src/app/accounts/handover/handover-v8.tsx:521` | <p className="bg-info-bg text-ink-secondary rounded-control px-4 py-3 text-xs leading-relaxed"> |
| `apps/web/src/app/inflow-links/detail/page.tsx:854` | <p className="rounded-control bg-success-bg px-4 py-3 text-xs font-semibold text-success">この経路から来た友だちと、付いたタグ・進んでいるシナリオは消えません。</p> |
| `apps/web/src/app/affiliates/v8-shared.tsx:60` | …className="af-list-kpiInfoPopover" role="note">{text}</span> : null} |
| `apps/web/src/app/affiliates/v8-shared.tsx:110` | …rn' ? 'af-list-noticeWarn' : ''}\`} role="status"> |
| `apps/web/src/app/affiliates/v8-shared.tsx:120` | …<div className="af-list-roBand" role="status"> |
| `apps/web/src/app/affiliates/v8-shared.tsx:175` | …<div className="af-list-stateWrap" role="status" aria-label="読み込み中"> |
| `apps/web/src/components/hq/banners/image-tile.tsx:85` | …className="flex flex-col gap-1.5" role="status" aria-live="polite"> |
| `apps/web/src/app/ec-commerce/page.tsx:378` | …="text-ink-secondary mb-4 text-xs" role="status"> |
| `apps/web/src/app/webhooks/_components/webhooks-v8-sheets.tsx:395` | <div role="status" className={\`${styles.banner} ${styles.bannerWarn}\`}> |
| `apps/web/src/app/automations/automations-v8.tsx:128` | <p className={styles.band} role="note"> |
| `apps/web/src/app/affiliates/v8-approvals-tab.tsx:745` | …<div className="af-list-notice" role="status" aria-label="まとめて処理の結果" style={{ margin: '12px 24px 0', alignItems: 'flex-start' }}> |
| `apps/web/src/app/inflow-links/_components/create-genre-modal.tsx:86` | className="rounded-control bg-success px-4 py-2 text-sm font-semibold text-on-accent hover:brightness-90 disabled:opacity-40" |
| `apps/web/src/app/automations/runs/page.tsx:524` | …4 py-3 text-sm text-ink-secondary" role="status">{retryNotice}</p> : null} |
| `apps/web/src/components/support/support-inbox.tsx:409` | …ateStatus('resolved')} className={\`rounded-control px-3 py-2 text-xs font-semibold ${detail.thread.status === 'resolved' ? 'bg-success text-on-accent' : 'bg-success-bg text-success'}\`}>✓ 対応済み</button> |
| `apps/web/src/components/support/support-inbox.tsx:416` | …<div className={\`max-w-[86%] rounded-card px-4 py-3 shadow-card sm:max-w-[72%] ${message.direction === 'outgoing' ? 'rounded-br-mini bg-success-bg text-ink' : 'rounded-bl-mini bg-canvas text-ink'}\`}> |
| `apps/web/src/app/webhooks/google-sheets-panel.tsx:367` | …<div role="alert" className="bg-status-warning-soft text-status-warning rounded-control mb-4 px-4 py-3 text-sm"> |
| `apps/web/src/app/webhooks/google-sheets-panel.tsx:372` | <div role="status" className="bg-status-warning-soft text-status-warning rounded-control mb-4 px-4 py-3 text-sm"> |
| `apps/web/src/app/webhooks/google-sheets-panel.tsx:423` | <span className="bg-status-warning-soft text-status-warning rounded-control shrink-0 px-3 py-1 text-xs font-semibold"> |
| `apps/web/src/app/webhooks/google-sheets-panel.tsx:430` | <p className="bg-status-warning-soft text-status-warning rounded-control mt-4 px-4 py-3 text-sm"> |
| `apps/web/src/app/webhooks/google-sheets-panel.tsx:499` | <div className="bg-status-warning-soft text-status-warning rounded-control mt-4 px-4 py-3 text-sm"> |
| `apps/web/src/app/webhooks/google-sheets-panel.tsx:505` | <div className="bg-status-warning-soft text-status-warning rounded-control mt-4 px-4 py-3 text-sm"> |
| `apps/web/src/app/webhooks/google-sheets-panel.tsx:510` | <div className="bg-status-warning-soft text-status-warning rounded-control mt-4 px-4 py-3 text-sm"> |
| `apps/web/src/app/webhooks/google-sheets-panel.tsx:596` | …<div role="alert" className="bg-status-warning-soft text-status-warning rounded-control mt-3 px-4 py-3 text-sm"> |
| `apps/web/src/app/inflow-links/_components/inflow-delete-dialog.tsx:99` | <p className="rounded-control bg-success-bg px-4 py-3 text-xs font-semibold text-success">この経路から来た友だちと、付いたタグ・進んでいるシナリオは消えません。</p> |
| `apps/web/src/app/scenarios/list-v8.tsx:793` | <span className="sr-only" role="status" aria-live="polite"> |
| `apps/web/src/app/scenarios/list-v8.tsx:1013` | …<div className={styles.roBand} role="status"> |
| `apps/web/src/app/chats/page.tsx:2340` | role="status" |
| `apps/web/src/app/chats/page.tsx:2364` | <div role="status" className="mb-4 rounded-control border border-hairline bg-canvas-sunken p-3 text-sm text-ink-secondary"> |
| `apps/web/src/app/chats/page.tsx:2938` | role="status" |
| `apps/web/src/app/chats/page.tsx:3473` | …<span className="rounded-pill bg-status-warn-soft text-status-warn-deep text-micro shrink-0 px-2 py-0.5 font-semibold"> |
| `apps/web/src/app/ec-commerce/connector-panel.tsx:215` | …on leading-relaxed text-ink-faint" role="note">{saveBlockReason}</p> : null} |
| `apps/web/src/app/automations/new/page.tsx:2065` | …items-center justify-between gap-2 rounded-control border border-info bg-info-bg px-4 py-3 text-sm font-medium text-info" |
| `apps/web/src/app/automations/new/page.tsx:2066` | role="note" |
| `apps/web/src/app/webhooks/webhook-overviews.tsx:911` | <p className="bg-info-bg text-info rounded-card px-4 py-3 text-sm leading-6"> |
| `apps/web/src/components/accounts/account-switcher.tsx:92` | <div role="status" className="flex h-16 w-full items-center gap-1.5 rounded-card border border-hairline bg-canvas px-2 text-left opacity-60"> |
| `apps/web/src/app/automations/new/weekday-select.tsx:51` | …="mt-2 text-xs text-ink-secondary" role="status"> |
| `apps/web/src/app/automations/new/new-v8.tsx:2195` | …<p className={styles.infoBand} role="note"> |
| `apps/web/src/app/automations/new/new-v8.tsx:2216` | …<div className={styles.infoBand} role="note"> |
| `apps/web/src/app/automations/new/new-v8.tsx:2473` | …e ? <p className={styles.footnote} role="status">{notice}</p> : null} |
| `apps/web/src/app/automations/runs-v8.tsx:454` | {retryNotice ? <p role="status" className={styles.footnote}>{retryNotice}</p> : null} |
| `apps/web/src/app/scenarios/detail/scenario-detail-client.tsx:1893` | …className="border-success bg-success-bg text-success flex flex-wrap items-center justify-between gap-3 rounded-card border px-4 py-3 text-sm" |
| `apps/web/src/app/scenarios/detail/scenario-detail-client.tsx:1894` | role="status" |
| `apps/web/src/app/scenarios/detail/scenario-detail-client.tsx:1918` | role="note" |
| `apps/web/src/app/getting-started/feature-set-card.tsx:181` | <p role="status" className="text-sm leading-relaxed text-ink-secondary"> |
| `apps/web/src/components/accounts/account-ordering.tsx:239` | …-14 cursor-grab items-center gap-3 rounded-control border px-4 py-3 transition-colors ${depth === 0 ? 'border-accent bg-accent-soft' : depth === 1 ? 'border-info bg-info-bg' : 'border-hairline bg-canvas'} ${draggedId ===… |
| `apps/web/src/components/accounts/account-ordering.tsx:261` | <section className="rounded-card border border-hairline bg-canvas p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-ink">LINEアカウント階層を編集</h2><p className=… |
| `apps/web/src/components/accounts/account-ordering.tsx:268` | …} onDrop={onDrop} className={\`mb-2 rounded-control border border-dashed px-3 py-2 text-center text-nano font-medium transition-shadow ${dragging ? 'ring-2 ring-info/20' : ''} ${blue ? 'border-info bg-info-bg text-info' :… |
| `apps/web/src/app/ops/members/page.tsx:175` | {notice ? <p role="status" className="text-caption text-accent-deep">{notice}</p> : null} |
| `apps/web/src/app/ops/dashboard/page.tsx:177` | {billingSyncNotice ? <p role="status" className="mb-2 text-caption text-accent-deep">{billingSyncNotice}</p> : null} |
| `apps/web/src/components/friend-fields/tags-page-v4.tsx:1086` | …ame') && <span className="shrink-0 rounded-pill bg-status-warn-soft px-2 py-0.5 text-micro font-medium text-status-warn-deep" title="正規化した名前がほかのタグと重なっています。整理候補です。">重複名</span>} |
| `apps/web/src/components/friend-fields/tags-page-v4.tsx:1181` | …ame') && <span className="shrink-0 rounded-pill bg-status-warn-soft px-2 py-0.5 text-micro font-medium text-status-warn-deep" title="正規化した名前がほかのタグと重なっています。整理候補です。">重複名</span>} |
| `apps/web/src/app/getting-started/page.tsx:92` | …<div className={styles.progress} role="note"> |
| `apps/web/src/app/scenarios/detail/detail-v8.tsx:2231` | …<p className={styles.startedBand} role="status"> |
| `apps/web/src/app/form-submissions/list-v8.tsx:1432` | <p className="border-info bg-info-bg text-ink rounded-control border px-3 py-2 text-sm" data-design-node="JV2oR"> |
| `apps/web/src/app/scenarios/results/results-v8.tsx:445` | …<div className={styles.bandWarn} role="status"> |
| `apps/web/src/app/scenarios/results/results-v8.tsx:460` | …<div className={styles.bandInfo} role="status"> |
| `apps/web/src/components/line-notifications/notification-run-list.tsx:47` | …eturn <span className="inline-flex rounded-pill bg-success-bg px-2 py-1 text-xs font-semibold text-success">{label}</span> |
| `apps/web/src/app/ops/support/page.tsx:517` | {notice ? <p role="status" className="mb-3 text-caption text-accent-deep">{notice}</p> : null} |
| `apps/web/src/app/ops/support/page.tsx:657` | …="text-caption text-ink-secondary" role="status">AIが下書きを作っています。5〜15秒ほどかかります。</p> |
| `apps/web/src/app/ops/support/page.tsx:836` | …="text-caption text-ink-secondary" role="status">AIが下書きを作っています。5〜15秒ほどかかります。</p> |
| `apps/web/src/components/friend-fields/tag-editor-v4.tsx:592` | …tions.length === 0 ? <p className="rounded-control border border-dashed border-hairline p-5 text-center text-sm text-ink-faint">連動アクションはまだありません</p> : <div className="overflow-x-auto pb-1"><ol className="space-y-2">{actio… |
| `apps/web/src/app/events/change-review/page.tsx:113` | …d-card border-hairline border p-4" role="status"> |
| `apps/web/src/app/ops/announcements/page.tsx:275` | {notice ? <p role="status" className="text-caption text-accent-deep">{notice}</p> : null} |
| `apps/web/src/app/auto-replies/runs/runs-v8.tsx:305` | <p className="bg-info-bg text-ink-secondary rounded-control mb-1 px-4 py-3 text-xs leading-relaxed"> |
| `apps/web/src/app/auto-replies/runs/runs-v8.tsx:577` | …ssage ? <p className={styles.hint} role="status">{actionMessage}</p> : null} |
| `apps/web/src/app/events/change-review/change-review-v8.tsx:165` | …d-card border-hairline border p-4" role="status"> |
| `apps/web/src/app/events/change-review/change-review-v8.tsx:219` | …<span className={receiving ? 'bg-success-bg text-success rounded-pill px-2 py-0.5 text-xs' : 'bg-canvas-sunken text-ink-faint rounded-pill px-2 py-0.5 text-xs'}> |
| `apps/web/src/app/scenarios/mode/page.tsx:643` | <p className="bg-info-bg text-info rounded-pill mb-1 px-2 py-0.5 text-center text-nano"> |
| `apps/web/src/app/form-submissions/edit/page.tsx:1173` | …p className="text-success text-sm" role="status">{notice}</p>} |
| `apps/web/src/app/ops/audit/page.tsx:189` | {exportNote ? <p role="status" className="mb-3 text-caption text-accent-deep">{exportNote}</p> : null} |
| `apps/web/src/app/auto-replies/runs/page.tsx:253` | <p className="bg-info-bg text-ink-secondary rounded-control mb-4 px-4 py-3 text-xs leading-relaxed"> |
| `apps/web/src/app/auto-replies/runs/page.tsx:390` | …p className={styles.actionMessage} role="status">{actionMessage}</p> : null} |
| `apps/web/src/app/events/page.tsx:454` | …<span className="bg-success-bg text-success rounded-pill px-2 py-0.5 text-xs"> |
| `apps/web/src/app/auto-replies/quick-create-v8.tsx:255` | …<p className={styles.overlapBand} role="status"> |
| `apps/web/src/app/nen-campaigns/nen-overview.tsx:841` | <p role="status" className="text-caption font-normal text-warning"> |
| `apps/web/src/app/auto-replies/list-v8.tsx:1077` | <span className="sr-only" role="status" aria-live="polite"> |
| `apps/web/src/app/auto-replies/list-v8.tsx:1440` | <p className="border-info bg-info-bg text-ink rounded-control border px-3 py-2 text-sm" data-design-node="Q5lOCc"> |
| `apps/web/src/components/identity/identity-decision-dialog.tsx:212` | …<p className={styles.confirmNote} role="status"> |
| `apps/web/src/app/auto-replies/page.tsx:340` | …ter gap-0.5 truncate px-1.5 py-0.5 rounded-mini text-nano bg-success-bg text-success font-medium" |
| `apps/web/src/app/auto-replies/page.tsx:372` | ? 'px-1.5 py-0.5 rounded-mini bg-info-bg text-info text-nano font-medium' |
| `apps/web/src/app/auto-replies/page.tsx:698` | …'inline-flex items-center gap-0.5 rounded-mini bg-success-bg px-1.5 py-0.5 text-nano font-medium text-success' |
| `apps/web/src/app/auto-replies/page.tsx:733` | <p className="bg-info-bg text-ink-secondary rounded-control px-4 py-3 text-xs leading-relaxed"> |
| `apps/web/src/app/auto-replies/page.tsx:895` | …line-flex items-center px-2 py-0.5 rounded-pill text-nano font-medium ${r.isActive ? 'bg-success-bg text-success' : 'bg-canvas-sunken text-ink-faint'}\`} |
| `apps/web/src/components/webinars/webinar-form.tsx:386` | <span className="w-fit rounded-pill bg-info-bg px-3 py-1 text-xs font-semibold text-info">{rules.length}枠</span> |
| `apps/web/src/components/webinars/webinar-form.tsx:396` | …lassName="mt-4 flex flex-col gap-1 rounded-card border border-info/25 bg-info-bg p-4 sm:flex-row sm:items-center sm:justify-between"> |
| `apps/web/src/components/webinars/webinar-form.tsx:401` | <div className="mt-4 rounded-card bg-status-warn-soft p-4 text-sm text-warning">毎日の配信枠は未設定です</div> |
| `apps/web/src/app/auto-replies/publish/page.tsx:749` | …<div className={"arp-infoNotice"} role="note"> |
| `apps/web/src/app/form-submissions/responses/page.tsx:564` | …sName="text-ink-secondary text-sm" role="status">{exportProgress}</p> |
| `apps/web/src/app/form-submissions/responses/page.tsx:650` | …sName="text-ink-secondary text-sm" role="status">{exportProgress}</p> |
| `apps/web/src/app/events/events-list-v8.tsx:724` | …? 'bg-success-bg text-success rounded-pill px-2 py-0.5 text-xs' |
| `apps/web/src/app/events/events-list-v8.tsx:839` | ? 'bg-success-bg text-success rounded-pill px-2 py-0.5 text-xs' |
| `apps/web/src/app/events/edit/page.tsx:129` | <span className="rounded-pill bg-success-bg text-success px-2 py-0.5 text-nano font-medium"> |
| `apps/web/src/app/auto-replies/edit/page.tsx:147` | <p className="bg-info-bg text-ink-secondary rounded-control mb-4 px-4 py-3 text-xs leading-relaxed"> |
| `apps/web/src/app/nen-campaigns/edit/campaign-editor-v8.tsx:298` | …ice ? <p className={styles.notice} role="status">{notice}</p> : null} |
| `apps/web/src/components/dashboard/getting-started-band.tsx:49` | role="note" |
| `apps/web/src/components/dashboard/getting-started-band.tsx:50` | className="border-info bg-info-bg relative flex items-center gap-3 rounded-card border px-4 py-3 pr-12" |
| `apps/web/src/app/mileage/v8-history-tab.tsx:304` | <p className={styles.band} role="note"> |
| `apps/web/src/app/mileage/v8-history-tab.tsx:356` | …<div className={styles.stateWrap} role="status" aria-label="読み込み中"> |
| `apps/web/src/app/automations/new/friend-multi-select.tsx:119` | …"px-3 py-2 text-xs text-ink-faint" role="status">探しています…</p> |
| `apps/web/src/app/auto-replies/edit/wizard-v8.tsx:1984` | role="status" |
| `apps/web/src/app/templates/page.tsx:1237` | …line-flex items-center px-2 py-0.5 rounded-pill text-nano font-medium bg-info-bg text-info"> |
| `apps/web/src/app/mileage/v8-score-tab.tsx:470` | <p className={styles.band} role="note"> |
| `apps/web/src/app/mileage/v8-score-tab.tsx:531` | …<div className={styles.stateWrap} role="status" aria-label="読み込み中"> |
| `apps/web/src/app/mileage/v8-score-tab.tsx:721` | …<div className={styles.stateWrap} role="status" aria-label="読み込み中"> |
| `apps/web/src/app/mileage/v8-score-tab.tsx:1078` | …{styles.band} ${styles.bandWarn}\`} role="note"> |
| `apps/web/src/app/mileage/mileage-v8.tsx:138` | <p className={styles.band} role="note"> |
| `apps/web/src/app/affiliate-offers/new-offer-v8.tsx:371` | …<p className="af-create-footnote" role="status">{saveNote}</p> : null} |
| `apps/web/src/app/templates/edit-v8.tsx:552` | <p role="status" className={styles.muted}>{saveGuard}</p> |
| `apps/web/src/components/dashboard/dashboard-editor.tsx:370` | …<div role="alert" className="bg-status-warn-soft text-status-warn-deep mt-2 rounded-control px-3 py-2.5 text-xs leading-relaxed"> |
| `apps/web/src/components/dashboard/dashboard-editor.tsx:395` | <p role="status" className="sr-only">{announcement}</p> |
| `apps/web/src/app/templates/detail/detail-v8.tsx:453` | …<div className={styles.card} role="status"> |
| `apps/web/src/app/templates/detail/detail-v8.tsx:471` | …<div className={styles.draftBand} role="status"> |
| `apps/web/src/app/booking/staff/shifts/staff-detail-v8.tsx:1237` | …<p className={shell.warnBand} role="status">Googleの接続設定がまだなのでつなげません。管理者に連絡してください。</p> |
| `apps/web/src/app/nen-members/photo-publications.tsx:229` | <div className="mt-2 rounded-control bg-status-warn-soft px-3 py-2 text-xs font-semibold text-status-warn-deep"> |
| `apps/web/src/app/mileage/v8-balances-tab.tsx:368` | <p className={styles.band} role="note"> |
| `apps/web/src/app/mileage/v8-balances-tab.tsx:468` | …<div className={styles.stateWrap} role="status" aria-label="読み込み中"> |
| `apps/web/src/app/mileage/score-rules/page.tsx:546` | …sName="text-xs text-ink-secondary" role="status"> |
| `apps/web/src/app/templates/edit/page.tsx:308` | …adFailed && !accountMismatch && <p role="status" className="text-ink-secondary text-sm">{saveGuard}</p>} |
| `apps/web/src/app/mileage/v8-rewards-tab.tsx:559` | …<p className={styles.band} role="note"> |
| `apps/web/src/app/mileage/v8-rewards-tab.tsx:638` | …<div className={styles.stateWrap} role="status" aria-label="読み込み中"> |
| `apps/web/src/app/booking/staff/shifts/liff-preview.tsx:110` | <div className="bg-info mt-3 rounded-card p-3"> |
| `apps/web/src/app/booking/staff/shifts/liff-preview.tsx:116` | …className="text-ink-faint text-sm" role="status">読み込み中...</p> |
| `apps/web/src/components/store-selection-gate.tsx:26` | …-h-64 items-center justify-center" role="status" aria-label="店舗を確認中"> |
| `apps/web/src/components/inbox/inbox-row.tsx:107` | <span className="rounded-pill bg-info-bg px-2 py-0.5 text-nano font-medium text-info"> |
| `apps/web/src/app/friends/migrations/migrations-v8.tsx:210` | <p role="status" className={styles.infoBand}> |
| `apps/web/src/app/mileage/v8-earning-rules-tab.tsx:595` | …<p className={styles.band} role="note"> |
| `apps/web/src/app/mileage/v8-earning-rules-tab.tsx:672` | …<div className={styles.stateWrap} role="status" aria-label="読み込み中"> |
| `apps/web/src/app/mileage/action-score-tab.tsx:43` | …<span className="whitespace-nowrap rounded-pill bg-status-warn-soft px-2.5 py-1 text-xs font-semibold text-status-warn-deep">{BAND_LABELS[band]}</span> |
| `apps/web/src/app/booking/staff/page.tsx:182` | …<span className="sr-only" role="status">予約スタッフを読み込んでいます</span> |
| `apps/web/src/app/booking/staff/page.tsx:255` | …lassName="inline-block px-2 py-0.5 rounded-mini bg-success-bg text-success text-xs">ON</span> |
| `apps/web/src/app/broadcasts/page.tsx:853` | …nter whitespace-nowrap px-1.5 py-0 rounded-mini text-nano font-medium bg-info-bg text-info"> |
| `apps/web/src/app/friends/migrations/page.tsx:120` | {message && <p role="status" className="bg-action-soft text-action rounded-control px-4 py-3 text-sm">{message}</p>} |
| `apps/web/src/app/broadcasts/list-v8.tsx:789` | …<div className={styles.roBand} role="status"> |
| `apps/web/src/app/booking/staff/new/staff-new-v8.tsx:547` | …<div className={shell.warnBand} role="status"> |
| `apps/web/src/app/contents/list-v8.tsx:1066` | …<p className={styles.roBand} role="note"> |
| `apps/web/src/components/broadcasts/broadcast-form.tsx:2528` | <span className="bg-success-bg text-success rounded-pill ml-2 px-2 py-0.5 text-micro font-normal"> |
| `apps/web/src/components/broadcasts/broadcast-form.tsx:2966` | ? 'rounded-control bg-success-bg p-3 text-sm text-success' |
| `apps/web/src/components/broadcasts/broadcast-form.tsx:2981` | ? 'rounded-control bg-success-bg p-2 text-xs text-success' |
| `apps/web/src/app/line-notifications/operator/new/operator-new-v8.tsx:389` | …<div className={styles.roBand} role="status"> |
| `apps/web/src/app/line-notifications/operator/new/operator-new-v8.tsx:563` | …? <p className={styles.formNotice} role="status">{notice}</p> : null} |
| `apps/web/src/app/settings/feature-settings-v8.tsx:426` | …ndWarn}\`} data-design-node="ziYCN" role="status"> |
| `apps/web/src/app/settings/file-scan/file-scan-v8.tsx:196` | {actionDone ? <p role="status" className={\`${styles.band} ${styles.bandInfo}\`}>{actionDone}</p> : null} |
| `apps/web/src/app/broadcasts/detail/broadcast-status-rail.tsx:133` | <p className="bg-info-bg text-ink-secondary mt-3 rounded-control px-3 py-2 text-xs leading-relaxed"> |
| `apps/web/src/app/contents/media-detail-dialog.tsx:623` | …<div className="mt-3 space-y-2" role="status"> |
| `apps/web/src/app/broadcasts/detail/page.tsx:996` | <div className="bg-info mt-3 min-h-48 rounded-card p-4"> |
| `apps/web/src/app/contents/vars/list-v8.tsx:962` | …<div className={styles.roBand} role="status"> |
| `apps/web/src/app/contents/vars/list-v8.tsx:1024` | …<div className={styles.alertBand} role="status"> |
| `apps/web/src/app/contents/vars/list-v8.tsx:1036` | …<div className={styles.alertBand} role="status"> |
| `apps/web/src/app/contents/vars/list-v8.tsx:1540` | …<p className={styles.dialogWarn} role="note"> |
| `apps/web/src/app/contents/vars/list-v8.tsx:1559` | …<p className={styles.dialogWarn} role="note"> |
| `apps/web/src/app/line-notifications/page.tsx:1268` | …span className={\`whitespace-nowrap rounded-pill px-2 py-0.5 text-xs font-semibold ${setting.isEnabled ? 'bg-success-bg text-success' : !setting.isEnabled && isIncomplete(setting) ? 'bg-warning-bg text-warning' : 'bg-canv… |
| `apps/web/src/app/booking/menus/settings-tabs/shared.tsx:109` | …s.skeletonRows} aria-label="読み込み中" role="status"> |
| `apps/web/src/app/booking/menus/page.tsx:1402` | {resourceMessage && <p role="status" className="text-xs text-ink-secondary">{resourceMessage}</p>} |
| `apps/web/src/app/contents/vars/page.tsx:796` | <div className="bg-status-warning-soft text-status-warning rounded-control px-4 py-3 text-sm font-semibold" role="status"> |
| `apps/web/src/app/contents/vars/page.tsx:802` | <div className="bg-status-warning-soft text-status-warning rounded-control px-4 py-3 text-sm font-semibold" role="status"> |
| `apps/web/src/app/booking/menus/staff/page.tsx:303` | …ext-ink-faint self-center text-xs" role="status" aria-live="polite"> |
| `apps/web/src/app/booking/menus/staff/page.tsx:454` | …<span className="bg-success-bg text-success rounded-pill px-2 py-0.5 text-nano"> |
| `apps/web/src/app/line-notifications/operator-notification-rules.tsx:183` | …span className={\`whitespace-nowrap rounded-pill px-2 py-0.5 text-xs font-semibold ${rule.status === 'published' ? 'bg-success-bg text-success' : 'bg-canvas-sunken text-ink-faint'}\`}>{rule.status === 'published' ? '出している'… |
| `apps/web/src/components/ui/sample-screen-notice.tsx:25` | role="note" |
| `apps/web/src/app/booking/menus/settings-tabs/hours-tab.tsx:561` | …styles.checkOk : styles.checkNg}\`} role="status"> |
| `apps/web/src/app/booking/bookings/page.tsx:997` | …sName="text-ink-secondary text-xs" role="status"> |
| `apps/web/src/app/booking/bookings/page.tsx:1035` | …sName="text-ink-secondary text-xs" role="status"> |
| `apps/web/src/app/booking/bookings/page.tsx:1229` | …className={\`${isLineBooking(b) ? 'bg-success-bg text-success' : 'bg-info-bg text-info'} rounded-pill px-2 py-0.5 text-xs\`} |
| `apps/web/src/app/booking/bookings/page.tsx:1518` | <div className="bg-success-bg text-success mb-3 w-fit rounded-pill px-3 py-1 text-xs font-semibold">予約が入っています</div> |
| `apps/web/src/app/booking/bookings/page.tsx:1617` | …lassName="text-danger bg-danger-bg rounded-mini px-3 py-1 text-xs font-medium hover:bg-status-danger-selected" |
| `apps/web/src/app/booking/bookings/page.tsx:1629` | className="bg-info-bg text-info rounded-mini px-3 py-1 text-xs font-medium hover:bg-hairline" |
| `apps/web/src/app/conversions/page.tsx:1202` | role="status" |
| `apps/web/src/app/conversions/page.tsx:1482` | …-ink-faint mt-2 text-xs leading-5" role="status"> |
| `apps/web/src/app/conversions/page.tsx:1690` | …="text-warning mt-1 block text-xs" role="status"> |
| `apps/web/src/app/booking/bookings/booking-calendar.tsx:670` | …="text-ink-secondary mb-4 text-xs" role="status"> |
| `apps/web/src/app/contents/vars/new/new-v8.tsx:397` | …<div className={styles.roBand} role="status"> |
| `apps/web/src/app/contents/vars/edit/edit-v8.tsx:771` | …<div className={styles.roBand} role="status"> |
| `apps/web/src/app/contents/vars/edit/edit-v8.tsx:1489` | …<p className={styles.validNote} role="status"> |
| `apps/web/src/app/rich-menus/list-v8.tsx:868` | <span className="sr-only" role="status" aria-live="polite"> |
| `apps/web/src/app/booking/menus/new/page.tsx:837` | <span className="bg-success-bg text-success rounded-pill ml-auto shrink-0 px-2 py-1 text-xs font-medium">{status}</span> |
| `apps/web/src/app/conversions/new/conversion-create-v8.tsx:570` | …<span className={styles.fieldNote} role="status">{valueModeNotice}</span> |
| `apps/web/src/app/conversions/new/conversion-create-v8.tsx:713` | …<p className={styles.fieldNote} role="status"> |
| `apps/web/src/app/contents/vars/edit/page.tsx:948` | <div className="bg-status-warning-soft text-status-warning rounded-control px-4 py-3 text-sm" role="status"> |
| `apps/web/src/app/emergency/page.tsx:510` | …'acknowledged' && <span className="rounded-pill bg-info-bg px-2 py-1 text-xs font-medium text-info">受領済み</span>}{alert.status === 'resolved' && <span className="rounded-pill bg-success-bg px-2 py-1 text-xs font-medium te… |
| `apps/web/src/app/emergency/page.tsx:813` | …{alertNotice && <div className={\`rounded-control px-4 py-3 text-xs font-medium ${alertNotice.tone === 'success' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}\`} role="status">{alertNotice.text}</div>} |
| `apps/web/src/app/emergency/page.tsx:964` | …<span className={\`shrink-0 rounded-pill px-2 py-0.5 font-bold ${path.state === 'stopped' ? 'bg-danger-bg text-danger' : path.state === 'running' ? 'bg-success-bg text-success' : 'bg-canvas-sunken text-ink-faint'}… |
| `apps/web/src/app/emergency/page.tsx:1352` | …utationLocked} className="min-h-11 rounded-control px-4 text-sm font-semibold text-action hover:bg-action-soft">キャンセル</button><Button variant="danger" className={(\`v7:min-h-11 rounded-control px-4 text-sm font-semibold t… |
| `apps/web/src/app/emergency/page.tsx:1401` | …tton variant="danger" className={(\`rounded-control v7:min-h-11 px-4 text-sm font-bold text-on-accent disabled:opacity-40 ${stepUpMode === 'stop' ? 'bg-danger hover:brightness-90' : 'bg-info hover:brightness-90'}\`) + ' bo… |
| `apps/web/src/app/conversions/conversion-points-v8.tsx:582` | …<p className={styles.secretBox} role="status"> |
| `apps/web/src/app/emergency/send-path-coverage-panel.tsx:93` | …<span className={\`shrink-0 rounded-pill px-2 py-0.5 font-bold ${path.state === 'stopped' ? 'bg-danger-bg text-danger' : path.state === 'running' ? 'bg-success-bg text-success' : 'bg-canvas-sunken text-ink-faint'}… |
| `apps/web/src/app/booking/menus/staff/assign-v8.tsx:315` | …<p className={shell.headNote} role="status" aria-live="polite"> |
| `apps/web/src/app/booking/menus/staff/assign-v8.tsx:343` | …<span className="sr-only" role="status">メニューと担当スタッフを読み込んでいます</span> |
| `apps/web/src/app/conversions/new/page.tsx:478` | …Name="text-ink-faint mt-3 text-xs" role="status">入力中の条件を試算しています。</p> : null} |
| `apps/web/src/app/conversions/new/page.tsx:498` | …ssName="text-warning mt-2 text-xs" role="status"> |
| `apps/web/src/app/conversions/new/page.tsx:641` | …ssName="text-warning mt-1 text-xs" role="status"> |
| `apps/web/src/app/booking/menus/new/menu-form-v8.tsx:730` | <span className="sr-only" role="status">メニューを読み込んでいます</span> |
| `apps/web/src/app/emergency/control-v8.tsx:506` | …<div className={styles.roBand} role="status"> |
| `apps/web/src/app/emergency/control-v8.tsx:522` | …backBand} ${styles.feedbackWarn}\`} role="status"> |
| `apps/web/src/app/emergency/control-v8.tsx:677` | …div className={styles.stoppedBand} role="status"> |
| `apps/web/src/app/conversions/_components/conversion-dialogs.tsx:291` | …-ink-faint mt-2 text-xs leading-5" role="status"> |
| `apps/web/src/app/conversions/_components/conversion-dialogs.tsx:555` | …="text-warning mt-1 block text-xs" role="status"> |
| `apps/web/src/app/rich-menus/edit/page.tsx:2195` | {schedulesNotice ? <p role="status" className="text-ink mt-2 text-xs">{schedulesNotice}</p> : null} |
| `apps/web/src/app/nen/members/rank-view.tsx:29` | …? 'inline-flex h-5.5 items-center rounded-pill bg-status-warn-soft px-2 text-nano font-medium text-status-warn-deep' |
| `apps/web/src/app/rich-menus/edit/test-apply-section.tsx:135` | {notice ? <p role="status" className="text-success mt-3 text-xs">{notice}</p> : null} |
| `apps/web/src/app/rich-menus/edit/publish-history.tsx:247` | {notice ? <p role="status" className="text-success mt-3 text-xs">{notice}</p> : null} |
| `apps/web/src/app/rich-menus/edit/publish-history.tsx:248` | {unappliedNote ? <p role="status" className="text-ink-secondary mt-3 text-xs">{unappliedNote}</p> : null} |
| `apps/web/src/app/nen/members/rank-settings-tab.tsx:161` | …Name="text-label text-accent-deep" role="status">{notice}</p> : null |
| `apps/web/src/app/nen/members/rank-settings-tab.tsx:178` | …Name="text-label text-accent-deep" role="status">{notice}</p> : null} |
| `apps/web/src/app/restaurant-test/google/google-profile.tsx:112` | …4 py-3 text-label leading-relaxed" role="note"> |
| `apps/web/src/app/restaurant-test/google/google-profile.tsx:583` | …={\`flex flex-col items-start gap-1 rounded-control border px-2 py-1.5 text-left text-label disabled:cursor-not-allowed disabled:opacity-40 ${selected ? 'text-on-accent border-transparent font-medium' : s \|\| changed ? 'bg… |
| `apps/web/src/app/webinars/list-v8.tsx:494` | …nRetry} /> : null}{refreshing ? <p role="status" className="text-ink-faint text-xs">検索中…</p> : null}<WebinarListTableV8 items={visibleItems} canEdit={canEdit} readonlyReason={readonlyReason} onArchive={onArchive} onOpenD… |
| `apps/web/src/app/restaurant-test/restaurant-console.tsx:78` | …turn <span className={\`inline-flex rounded-pill px-2 py-1 text-micro font-bold ${good ? 'bg-success-bg text-success' : warning ? 'bg-warning-bg text-warning' : 'bg-canvas-sunken text-ink-secondary'}\`}>{labels[value] \|\| v… |
| `apps/web/src/app/restaurant-test/restaurant-console.tsx:169` | …{notice && <div className={\`mb-4 rounded-control border px-4 py-3 text-sm ${notice.tone === 'success' ? 'border-success bg-success-bg text-success' : 'border-danger bg-danger-bg text-danger'}\`}>{notice.text}</div>} |
| `apps/web/src/app/restaurant-test/restaurant-console.tsx:319` | …{notice && <div className="rounded-control border border-success bg-success-bg px-4 py-3 text-sm font-semibold text-success">{notice}</div>} |
| `apps/web/src/app/restaurant-test/restaurant-console.tsx:670` | …r) => s + r.walk_in_capacity, 0), 'bg-info']].map(([label, value, color]) => <div key={String(label)}><div className="flex justify-between text-xs"><span>{label}</span><span className="font-semibold">{value}</span></div>… |
| `apps/web/src/app/hq/open/page.tsx:63` | …-h-64 items-center justify-center" role="status" aria-label="移動先を確認中"> |
| `apps/web/src/app/hq/open/page.tsx:104` | …-h-64 items-center justify-center" role="status" aria-label="アカウントを読み込み中"> |
| `apps/web/src/app/nen/members/members-v8.tsx:739` | …ice ? <p className={styles.notice} role="status">{notice}</p> : null |
| `apps/web/src/app/nen/members/members-v8.tsx:767` | …ice ? <p className={styles.notice} role="status">{notice}</p> : null} |
| `apps/web/src/app/nen/members/members-v8.tsx:1026` | …ice ? <p className={styles.notice} role="status">{notice}</p> : null |
| `apps/web/src/app/nen/members/members-v8.tsx:1034` | …ice ? <p className={styles.notice} role="status">{notice}</p> : null} |
| `apps/web/src/app/friend-add-settings/runs/runs-v8.tsx:471` | …te ? <p className={styles.csvNote} role="status">{csvNote}</p> : null} |
| `apps/web/src/app/hq/hq-template-page.tsx:29` | return <Suspense fallback={<p role="status">{label}を読み込み中…</p>}> |
| `apps/web/src/app/friend-add-settings/publish/page.tsx:538` | …sName="text-xs text-ink-secondary" role="status">{stopMessage}</p>} |
| `apps/web/src/app/nen/members/lifetime-tab.tsx:112` | …Name="text-label text-accent-deep" role="status">{notice}</p> : null |
| `apps/web/src/app/nen/members/lifetime-tab.tsx:139` | …Name="text-label text-accent-deep" role="status">{notice}</p> : null} |
| `apps/web/src/app/hq/page.tsx:131` | …="mb-4 text-sm text-ink-secondary" role="status">{connectionProgress}</p> : null} |
| `apps/web/src/app/hq/page.tsx:157` | …-h-64 items-center justify-center" role="status" aria-label="アカウントを読み込み中"> |
| `apps/web/src/app/tags/tag-rows-skeleton.tsx:18` | …iv className={styles.formSkeleton} role="status"> |
| `apps/web/src/app/tags/tag-rows-skeleton.tsx:31` | …iv className={styles.skeletonRows} role="status" data-design-node={designNode}> |
| `apps/web/src/app/webinars/edit/basic-v8.tsx:195` | …<p className="wb-basic-fieldHelp" role="status">{testResult}</p> : null} |
| `apps/web/src/app/friend-add-settings/editor-v8.tsx:452` | …? <p className={styles.noticeBand} role="status">{notice}</p> : null} |
| `apps/web/src/app/friend-add-settings/editor-v8.tsx:454` | …<p className={styles.readonlyBand} role="note"> |
| `apps/web/src/app/friend-add-settings/runs/detail/page.tsx:289` | {notice && <p role="status" className="text-sm font-bold">{notice}</p>} |
| `apps/web/src/app/restaurant-test/stores/new/page.tsx:245` | <p className="rounded-control bg-info-bg px-4 py-3 text-sm leading-6 text-ink-secondary">LINE公式アカウントのチャネルIDとチャネルシークレットを使用して、アカウントセットアップを行います。</p> |
| `apps/web/src/app/friend-add-settings/runs/detail/detail-v8.tsx:292` | …ice ? <p className={styles.notice} role="status">{notice}</p> : null} |
| `apps/web/src/app/webinars/edit/participants-shared.tsx:48` | …rink-0 items-center justify-center rounded-pill bg-info-bg font-bold text-info ring-2 ring-canvas\`}> |
| `apps/web/src/app/friend-add-settings/list-v8.tsx:511` | …iv className={styles.skeletonRows} role="status"> |
| `apps/web/src/app/friend-add-settings/list-v8.tsx:581` | <span className="sr-only" role="status" aria-live="polite"> |
| `apps/web/src/app/friend-add-settings/list-v8.tsx:769` | …<p className={styles.readonlyBand} role="note"> |
| `apps/web/src/app/tags/edit-tag-page-v8.tsx:239` | …rder p-4" data-design-node="fkGUR" role="note"> |
| `apps/web/src/app/webinars/edit/notifications-v8.tsx:123` | {testResult ? <p role="status" className="text-ink-secondary text-xs">{testResult}</p> : null} |
| `apps/web/src/app/restaurant-test/v8/shell.tsx:218` | <div role="status" className={\`${styles.notice} ${notice.tone === 'success' ? styles.noticeSuccess : styles.noticeError}\`}> |
| `apps/web/src/app/hq/members/page.tsx:181` | …Name="text-label text-accent-deep" role="status">{notice}</p> : null} |
| `apps/web/src/app/hq/members/page.tsx:237` | …? 'inline-flex h-5.5 items-center rounded-pill bg-status-warn-soft px-2 text-nano font-medium text-status-warn-deep' |
| `apps/web/src/app/hq/members/page.tsx:239` | …? 'inline-flex h-5.5 items-center rounded-pill bg-status-danger-soft px-2 text-nano font-medium text-danger' |
| `apps/web/src/app/webinars/edit/participants-v8.tsx:185` | …order p-8 text-center shadow-card" role="note"> |
| `apps/web/src/app/tags/searches/edit/page.tsx:941` | …age.kind}:${usage.id}\`} className="rounded-control bg-status-warn-soft p-2"> |
| `apps/web/src/app/hq/settings/page.tsx:113` | …Name="text-label text-accent-deep" role="status">保存しました。</p> : null} |
| `apps/web/src/app/webinars/edit/analytics-funnel-v8.tsx:95` | className="bg-success block h-5 rounded-control" |
| `apps/web/src/app/hq/banners/project/page.tsx:492` | …nano font-medium text-status-info" role="status"> |
| `apps/web/src/app/webinars/edit/review-v8.tsx:126` | …Name="text-ink-faint py-3 text-sm" role="status">公開前検査を読み込んでいます。</li> : null} |
| `apps/web/src/app/webinars/edit/review-v8.tsx:130` | …="text-ink-secondary mt-2 text-xs" role="status">{testNotice}</p> : null} |
| `apps/web/src/app/hq/templates/template-console.tsx:387` | {message && <p role="status" className={\`${styles.notice} ${styles.success}\`}>{message}</p>} |
| `apps/web/src/app/hq/templates/template-console.tsx:389` | …styles.panel} ${styles.empty}\`}><p role="status">{busy ? 'ひな形を読み込み中…' : '読み込めませんでした。権限や接続を確認し、ページを再読み込みしてください。'}</p></section> : <> |
| `apps/web/src/app/hq/templates/template-console.tsx:480` | <p role="status" className={styles.muted}>配布番号：{pendingRun} の結果を確認しています。確認できるまでは再配布しません。</p> |
| `apps/web/src/app/hq/templates/template-console.tsx:483` | …\`${styles.panel} ${styles.empty}\`} role="status">結果を確認中です。確認できるまでは再配布しません。</p> |
| `apps/web/src/app/webinars/edit/viewer-comments.tsx:32` | : comments === null ? <p role="status" className="text-ink-faint text-xs">コメントを読み込んでいます…</p> |
| `apps/web/src/app/hq/templates/page.tsx:25` | return <Suspense fallback={<p role="status">テンプレートを読み込み中…</p>}><Content /></Suspense> |
| `apps/web/src/app/hq/templates/template-definition-editor.tsx:104` | …たは843px。'}</small>{uploading && <p role="status">画像を登録しています…</p>}{error && <p role="alert">{error}</p>}</div> |
| `apps/web/src/app/hq/support/detail/page.tsx:272` | …Name="text-label text-accent-deep" role="status">{notice}</p> : null} |
| `apps/web/src/app/nen/pets/feeding-tab.tsx:181` | …Name="text-label text-accent-deep" role="status">{notice}</p> : null |
| `apps/web/src/app/nen/pets/feeding-tab.tsx:196` | …Name="text-label text-accent-deep" role="status">{notice}</p> : null} |
| `apps/web/src/app/webinars/edit/video-stages.tsx:124` | ? 'rounded-pill bg-success-bg px-2 py-1 text-micro font-semibold text-success' |
| `apps/web/src/app/nen/pets/pets-v8.tsx:600` | …ice ? <p className={styles.notice} role="status">{notice}</p> : null} |
| `apps/web/src/app/webinars/edit/analytics-v8.tsx:66` | …className="text-ink-faint text-sm" role="status">分析データを読み込んでいます…</p> |

## ダイアログ・空の表示

検索候補：341 行。

|場所|該当箇所（長い行は抜粋）|
|---|---|
| `apps/web/src/components/session-lost-notice.tsx:50` | role="alertdialog" |
| `apps/web/src/components/reminders/reminder-publish-flow.tsx:390` | …ngs, recipientName).length === 0 ? <p className="text-ink-faint text-xs">本文に差し込み値はありません。</p> : <table className="w-full text-left text-xs"><thead><TableHeadRow><Th>変数</Th><Th>テストで使う値</Th><Th>本番での取得元</Th></TableHeadRow></… |
| `apps/web/src/app/analytics/reports/new/page.tsx:1050` | </Disclosure> : <p className="report-v8-sub">保存した分析がありません。</p>} |
| `apps/web/src/components/events/event-form.tsx:702` | <div className="text-sm text-ink-faint italic p-2">アクティブなアカウントがありません</div> |
| `apps/web/src/components/events/event-form.tsx:1101` | <div ref={panelRef} role="dialog" aria-modal="true" aria-label="予約枠を追加" className="bg-canvas rounded-control shadow-float p-6 w-full max-w-md mx-4"> |
| `apps/web/src/components/events/event-form.tsx:1226` | <div ref={panelRef} role="dialog" aria-modal="true" aria-label="予約枠を編集" className="bg-canvas rounded-card mx-4 w-full max-w-md p-6 shadow-float"> |
| `apps/web/src/app/analytics/page.tsx:899` | <p className="text-ink-faint mt-2 text-xs">同じ分析をもう一度押す必要はありません。このままお待ちください。</p> |
| `apps/web/src/app/analytics/page.tsx:1642` | {noRun && !run && <p className="text-ink-faint mt-2 text-xs">まだ集計がありません。「この{funnelDays}日を再集計」を押してください</p>} |
| `apps/web/src/app/analytics/page.tsx:2366` | <p className="mt-1 text-xs text-ink-faint">こちらで作った中継URLを、相手が押した時刻で時間帯ごとに並べています。送った時刻ではありません。</p> |
| `apps/web/src/app/analytics/page.tsx:2668` | <div className="text-ink-faint">保存された数値はありません。</div> |
| `apps/web/src/app/analytics/page.tsx:2931` | <p className="text-ink text-sm font-medium">定期レポートはまだありません</p> |
| `apps/web/src/app/analytics/page.tsx:3056` | <p className="text-ink font-medium">保存した分析はまだありません</p> |
| `apps/web/src/app/analytics/page.tsx:3156` | <p className="text-ink-faint mt-4 text-sm">保存された結果はありません</p> |
| `apps/web/src/app/not-found.tsx:16` | <h2 className="text-title font-bold text-ink">このページは見つかりませんでした</h2> |
| `apps/web/src/components/friends/advanced-search-dialog.tsx:453` | role="dialog" |
| `apps/web/src/components/friends/advanced-search-dialog.tsx:829` | role="dialog" |
| `apps/web/src/app/reminders/wizard-v8-ui.tsx:217` | <div className={styles.phoneBubble}>{message ?? '本文はまだありません'}</div> |
| `apps/web/src/app/reminders/list-v8.tsx:778` | <p className={styles.stateTitle}>条件に合うリマインダはありません</p> |
| `apps/web/src/app/reminders/list-v8.tsx:799` | <p className={styles.stateTitle}>まだリマインダはありません</p> |
| `apps/web/src/components/friends/notice-dialog.tsx:34` | role="dialog" |
| `apps/web/src/components/dashboard/friend-trend-table.tsx:51` | return <p className="text-ink-faint px-5 py-6 text-center text-sm">この期間の推移はまだありません</p> |
| `apps/web/src/app/reminders/detail/detail-v8.tsx:601` | <p className={styles.cardNote}>まだ実行した通知はありません。届き始めるとここに出ます。</p> |
| `apps/web/src/components/inflow-links/site-script-v8.tsx:480` | <p className={styles.cardNote}>まだ許可したドメインがありません。</p> |
| `apps/web/src/components/inflow-links/site-script.tsx:346` | <p className="mt-1 text-xs leading-relaxed text-ink-faint">ホームページの &lt;/head&gt; の直前に、この1行をそのまま貼ってください。ページごとに書き換える必要はありません。</p> |
| `apps/web/src/components/friends/bulk-operation-editor.tsx:99` | {items.length === 0 ? <p className="text-xs text-ink-secondary">選べる{label}がありません。登録してから、もう一度開いてください。</p> : null} |
| `apps/web/src/app/health/page.tsx:400` | <p className="text-sm text-ink-faint text-center py-4">ヘルスログがありません</p> |
| `apps/web/src/components/chats/inbox-filter-panel.tsx:94` | role="dialog" |
| `apps/web/src/app/accounts/new/register-v8.tsx:671` | <span className={styles.fieldHelp}>タグはまだありません。下から追加できます。</span> |
| `apps/web/src/components/friends/saved-search-dialog.tsx:85` | role="dialog" |
| `apps/web/src/components/friends/saved-search-dialog.tsx:145` | <p className="text-sm font-semibold text-ink-secondary">保存した条件はまだありません。</p> |
| `apps/web/src/components/dashboard/qr-dialog.tsx:303` | role="dialog" |
| `apps/web/src/components/auto-replies/edit-dialog.tsx:1299` | <p className="text-ink-faint mt-1">過去28日の受信に、この条件をあてはめた結果です。これから来る受信の件数ではありません。</p> |
| `apps/web/src/components/templates/message-template-editor.tsx:219` | <p className="text-ink rounded-card bg-canvas px-4 py-3 text-sm leading-6 whitespace-pre-wrap">{preview.content \|\| '（本文がまだありません）'}</p> |
| `apps/web/src/components/templates/message-template-editor.tsx:349` | …{messageUrls.length === 0 ? <p className="text-ink-faint px-3 py-3">本文にURLはありません。</p> : messageUrls.map((url) => <div key={url} className="grid grid-cols-3 gap-3 px-3 py-3 text-ink"><span className="truncate" titl… |
| `apps/web/src/app/auto-replies/runs/page.tsx:375` | ) : <p className={styles.quiet}>確認が必要なエラーはありません。</p>} |
| `apps/web/src/app/no-permission/no-permission-v8.tsx:58` | <p className={styles.title}>{featureName}を開く権限がありません</p> |
| `apps/web/src/components/scenarios/bulk-preview-modal.tsx:152` | <p className="text-ink-faint text-sm">ステップがありません</p> |
| `apps/web/src/components/chats/inbox-dropdown.tsx:223` | <p className="text-ink-faint px-3 py-3 text-xs">見つかりません</p> |
| `apps/web/src/components/chats/inbox-dropdown.tsx:449` | {shown.length === 0 ? <p className="text-ink-faint px-3 py-3 text-xs">見つかりません</p> : null} |
| `apps/web/src/components/dashboard/shipment-panel.tsx:173` | <p className="py-6 text-center text-sm text-ink-faint">この期間の出荷予定はありません</p> |
| `apps/web/src/components/scenarios/action-editor.tsx:704` | <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="action-editor-title" data-design-node="hz9ti" className={\`${styles.dialog} flex w-full flex-col overflow-hidden rounded-card shadow-float\`}> |
| `apps/web/src/components/scenarios/action-editor.tsx:945` | <p className="text-ink-secondary mt-1.5 text-xs">選べる{kindName}がありません。</p> |
| `apps/web/src/components/chats/friend-info-sidebar.tsx:720` | role="dialog" |
| `apps/web/src/components/chats/friend-info-sidebar.tsx:1032` | …{effectiveNotes \|\| <span className="text-ink-faint">まだありません</span>} |
| `apps/web/src/components/chats/friend-info-sidebar.tsx:1320` | return <p className="text-micro text-ink-faint italic">まだ登録がありません</p> |
| `apps/web/src/components/chats/friend-info-sidebar.tsx:1374` | <p className="text-micro text-ink-faint italic">購入はまだありません</p> |
| `apps/web/src/components/chats/friend-info-sidebar.tsx:1406` | <p className="text-micro text-ink-faint italic">回答はまだありません</p> |
| `apps/web/src/components/chats/friend-info-sidebar.tsx:1459` | <div className="p-4 text-xs text-ink-faint">友だち情報がありません</div> |
| `apps/web/src/app/form-submissions/list-v8.tsx:1255` | <p className={styles.stateTitle}>確認できる未割り当てフォームはありません</p> |
| `apps/web/src/app/form-submissions/list-v8.tsx:1263` | <p className={styles.stateTitle}>担当未割り当てのフォームはありません</p> |
| `apps/web/src/app/form-submissions/list-v8.tsx:1271` | <p className={styles.stateTitle}>まだ回答フォームはありません</p> |
| `apps/web/src/app/form-submissions/list-v8.tsx:1280` | <p className={styles.stateTitle}>条件に合うフォームはありません</p> |
| `apps/web/src/components/chats/saved-view-dialog.tsx:144` | role="dialog" |
| `apps/web/src/app/auto-replies/list-v8.tsx:1049` | <p className={styles.stateTitle}>条件に合うルールはありません</p> |
| `apps/web/src/app/auto-replies/list-v8.tsx:1060` | <p className={styles.stateTitle}>まだ自動応答のルールはありません</p> |
| `apps/web/src/app/reminders/edit/issue469-reminder-screens.tsx:252` | …{settings.steps.length === 0 ? <p className="text-ink-faint rounded-control border border-hairline p-3 text-xs">通知はまだありません。「通知を追加」で1通目を作成してください。本文が入るまで次へは進めません。</p> : null} |
| `apps/web/src/app/reminders/edit/issue469-reminder-screens.tsx:396` | …t.settings, sentTo).length === 0 ? <p className="text-ink-faint px-3 py-3 text-xs">本文に差し込み値はありません。</p> : <table className="w-full border-collapse text-left text-xs"><thead><TableHeadRow><Th>変数</Th><Th>テストで使う値</Th><Th>本番で… |
| `apps/web/src/components/chats/template-picker.tsx:339` | role="dialog" |
| `apps/web/src/components/automations/common-action-editor.tsx:184` | …length === 0 && !resourcesFailed ? <span className="text-warning mt-1 block text-xs">選べる{label}がありません</span> : null} |
| `apps/web/src/components/automations/common-action-editor.tsx:260` | return <p className="text-ink-faint text-sm">この処理には追加設定はありません。</p> |
| `apps/web/src/app/reminders/edit/edit-v8.tsx:585` | <p className="text-ink-secondary mt-3 text-sm">違いは見つかりませんでした。そのまま読み込めます。</p> |
| `apps/web/src/app/reminders/edit/edit-v8.tsx:1100` | <p className={styles.fieldNote}>通知はまだありません。「通知を足す」で1通目を作成してください。本文が入るまで次へは進めません。</p> |
| `apps/web/src/app/booking/staff/shifts/page.tsx:1083` | <p className="text-ink-faint text-sm">休業日はありません</p> |
| `apps/web/src/app/auto-replies/publish/page.tsx:1003` | …<section className={"arp-dialog"} role="dialog" aria-modal="true" aria-labelledby="test-dialog-title"> |
| `apps/web/src/app/reminders/basics-form-v8.tsx:355` | <p className={styles.fieldNote}>このアカウントに日付型の情報欄がまだありません。友だち情報欄から追加してください。</p> |
| `apps/web/src/components/dashboard/dashboard-editor.tsx:346` | <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="dashboard-editor-title" className="bg-canvas flex h-full w-full max-w-[540px] flex-col shadow-float" onMouseDown={(event) => event.stopPropagat… |
| `apps/web/src/app/webhooks/page.tsx:795` | …form onSubmit={handleRotateSubmit} role="dialog" aria-modal="true" aria-labelledby="rotate-secret-title" className="bg-canvas rounded-control shadow-float max-w-lg w-full p-6"> |
| `apps/web/src/app/webhooks/page.tsx:859` | …<div ref={secretModalRef} role="dialog" aria-modal="true" aria-labelledby="created-secret-title" className="bg-canvas rounded-control shadow-float max-w-lg w-full p-6"> |
| `apps/web/src/components/scenarios/scenario-dialogs.tsx:58` | <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="rounded-panel flex w-full flex-col shadow-float" style={wide ? { marginBlock: 68, height: 912, maxHeight: 'calc(100dvh - 168p… |
| `apps/web/src/components/scenarios/scenario-dialogs.tsx:935` | …ext-xl font-bold">選択した1名へ実際に送信</h2><p className="text-ink-secondary mt-1 text-sm">選んだ友だちのLINEへ、実際のメッセージが届きます。操作者専用の宛先ではありません。</p> |
| `apps/web/src/components/scenarios/scenario-dialogs.tsx:966` | …<div ref={confirmPanelRef} role="dialog" aria-modal="true" aria-labelledby="test-send-confirm-title" className="w-full rounded-panel shadow-float" style={{ maxWidth: 672, background: 'var(--color-canvas)' }}><div… |
| `apps/web/src/components/scenarios/scenario-dialogs.tsx:1076` | <p className="text-ink-faint px-4 py-6 text-center text-sm">見つかりません</p> |
| `apps/web/src/components/scenarios/scenario-dialogs.tsx:1288` | <p className="text-ink-faint px-4 py-6 text-center text-sm">見つかりません</p> |
| `apps/web/src/components/scenarios/scenario-dialogs.tsx:1371` | <p className="text-ink-faint px-1 text-sm">配信される通がありません。</p> |
| `apps/web/src/app/form-submissions/edit/page.tsx:1159` | <p className="text-ink-secondary mt-2 text-sm">回答用URLを発行する設定がまだありません。LINEアカウント設定を確認してください。</p> |
| `apps/web/src/app/form-submissions/edit/page.tsx:1241` | <p className="text-ink-secondary mt-3 text-sm">違いは見つかりませんでした。そのまま読み込めます。</p> |
| `apps/web/src/app/booking/staff/shifts/staff-detail-v8.tsx:910` | <p className={shell.stateTitle}>{ownStaffId ? '自分の勤務だけを表示できます' : 'ひも付いた予約スタッフがありません'}</p> |
| `apps/web/src/app/booking/staff/shifts/staff-detail-v8.tsx:931` | <p className={shell.stateTitle}>担当者が見つかりませんでした</p> |
| `apps/web/src/app/booking/staff/shifts/staff-detail-v8.tsx:1039` | <p className={shell.sectionDesc}>休憩はありません。</p> |
| `apps/web/src/app/booking/staff/shifts/staff-detail-v8.tsx:1089` | <p className={shell.sectionDesc}>この日だけの休み・シフト・休憩はありません。いつもの勤務時間どおりに枠が出ます。</p> |
| `apps/web/src/app/booking/staff/shifts/staff-detail-v8.tsx:1462` | <p className={shell.stateTitle}>ひも付いた予約スタッフがありません</p> |
| `apps/web/src/components/dashboard/side-cards.tsx:306` | <p className="text-ink-faint text-xs leading-relaxed">予定されている配信・予約はありません。</p> |
| `apps/web/src/components/dashboard/side-cards.tsx:356` | <p className="text-ink-faint text-xs leading-relaxed">予定されている配信・予約はありません。</p> |
| `apps/web/src/app/form-submissions/edit/form-design-settings.tsx:174` | role="dialog" |
| `apps/web/src/app/events/change-review/page.tsx:134` | <p className="text-ink-faint mt-2 text-sm">開催回がありません。編集で開催回を足してから、もう一度開いてください。</p> |
| `apps/web/src/app/events/change-review/page.tsx:293` | <span className="text-ink-faint">影響はありません</span> |
| `apps/web/src/app/auto-replies/edit/wizard-v8.tsx:2229` | <p className={styles.hint}>同時に当たるルールはありません。</p> |
| `apps/web/src/app/auto-replies/edit/wizard-v8.tsx:2401` | <p className="text-ink-secondary mt-3 text-sm">違いは見つかりませんでした。そのまま読み込めます。</p> |
| `apps/web/src/app/booking/staff/shifts/liff-preview.tsx:134` | <p className="text-ink text-sm font-bold">この週は空きがありません</p> |
| `apps/web/src/app/accounts/detail/page.tsx:427` | <p className="text-ink-secondary mt-2 text-xs">送らなかった配信はありません。</p> |
| `apps/web/src/app/mileage/v8-score-tab.tsx:742` | <p className={styles.stateTitle}>条件に合うできごとはありません</p> |
| `apps/web/src/app/webhooks/incoming-v8.tsx:888` | <p className={styles.cardNote}>いま確認が必要な届物はありません。</p> |
| `apps/web/src/app/webhooks/incoming-v8.tsx:1057` | …(e) => void handleRotateSubmit(e)} role="dialog" aria-modal="true" aria-labelledby="webhook-v8-in-rotate-title" className="bg-canvas rounded-control shadow-float max-w-lg w-full p-6"> |
| `apps/web/src/app/events/change-review/change-review-v8.tsx:184` | <p className="text-ink-faint mt-2 text-sm">開催回がありません。編集で開催回を足してから、もう一度開いてください。</p> |
| `apps/web/src/app/events/change-review/change-review-v8.tsx:336` | <p className="text-ink-faint mt-2 text-sm">開催回がありません。編集で開催回を足してから、もう一度開いてください。</p> |
| `apps/web/src/components/merged-person/merged-person-detail-v8.tsx:213` | <p className={styles.sectionDesc}>まだ履歴はありません。</p> |
| `apps/web/src/components/merged-person/merged-person-detail-v8.tsx:244` | <p className={styles.sectionDesc}>まだ値はありません。</p> |
| `apps/web/src/app/booking/staff/shifts/staff-detail.tsx:906` | <p className="text-ink-faint text-sm">休憩はありません。</p> |
| `apps/web/src/app/booking/staff/shifts/staff-detail.tsx:972` | <p className="text-ink-faint text-sm">この日だけの休憩はありません。</p> |
| `apps/web/src/app/booking/staff/shifts/staff-detail.tsx:1051` | <p className="text-ink-faint text-sm">日ごとのシフトはありません。いつもの勤務時間どおりに枠が出ます。</p> |
| `apps/web/src/app/friends/detail/page.tsx:1569` | <span className="text-ink-faint text-xs">タグはありません</span> |
| `apps/web/src/app/friends/detail/page.tsx:1758` | …elivery.id}\`}>詳細を見る</Link></div> : <p className="mt-3 text-xs text-ink-faint">確定した配信予定はありません</p>} |
| `apps/web/src/app/friends/detail/page.tsx:1894` | <p className="text-ink-faint text-xs">登録できるシナリオがありません。</p> |
| `apps/web/src/components/ops/knowledge-editor.tsx:93` | …rticleKind === 'answer_example' && <p data-design-node="aeEmptyAnswerNote" className={styles.emptyAnswerNote}>運営の回答がありません。答えを書いて承認できます</p>} |
| `apps/web/src/components/ops/knowledge-editor.tsx:113` | : <p>回答例はお客様の成功確認を示すものではありません。質問と運営の回答内容を元のやり取りで確認してください。</p>} |
| `apps/web/src/app/staff/page.tsx:153` | …enter justify-center bg-scrim p-4" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div ref={panelRef} className={\`max-h-[90vh] w-full overflow-y-auto roun… |
| `apps/web/src/app/staff/page.tsx:159` | return <p className="text-xs font-medium text-ink-secondary">{count ? \`このユーザーにはログイン履歴が ${count} 件あります\` : 'ログイン履歴はありません'}</p> |
| `apps/web/src/app/staff/page.tsx:209` | …います…</p> : sessions.length === 0 ? <p className="mt-3 text-xs text-ink-faint">ログイン中の端末はありません。</p> : ( |
| `apps/web/src/app/webhooks/outgoing-v8.tsx:789` | …(e) => void handleRotateSubmit(e)} role="dialog" aria-modal="true" aria-labelledby="webhook-v8-rotate-title" className="bg-canvas rounded-control shadow-float max-w-lg w-full p-6"> |
| `apps/web/src/components/scenarios/carousel-picker.tsx:125` | <p className="text-ink text-sm font-bold">カルーセルがまだありません</p> |
| `apps/web/src/components/merged-person/merged-person-sections.tsx:142` | <p className={styles.empty}>結び付いている友だちはまだありません。</p> |
| `apps/web/src/components/merged-person/merged-person-sections.tsx:214` | <p className={styles.empty}>採用した値はまだありません。</p> |
| `apps/web/src/components/merged-person/merged-person-sections.tsx:253` | <p className={styles.empty}>まだ記録がありません。</p> |
| `apps/web/src/app/form-submissions/responses/page.tsx:493` | <p className="text-ink text-sm font-bold">条件に合う回答はありません</p> |
| `apps/web/src/app/form-submissions/responses/page.tsx:808` | <p className="text-ink-faint mt-1 text-xs">この回答には後処理の記録がありません</p> |
| `apps/web/src/app/form-submissions/responses/page.tsx:871` | <aside ref={panelRef} role="dialog" aria-modal="true" aria-label="回答詳細" className="bg-canvas relative h-full w-full max-w-md overflow-y-auto p-5 shadow-float"> |
| `apps/web/src/app/events/page.tsx:338` | <p className="text-ink mb-2 font-medium">イベントがまだありません</p> |
| `apps/web/src/app/mileage/friends/detail/page.tsx:332` | )) : <span className="text-sm text-ink-faint">接続先はありません</span>} |
| `apps/web/src/app/mileage/friends/detail/page.tsx:360` | …{reasonSummary.length === 0 ? <p className="p-4 text-sm text-ink-faint">付与理由の記録はありません</p> : reasonSummary.slice(0, 5).map((reason) => ( |
| `apps/web/src/app/ec-commerce/page.tsx:461` | …<Td>{action.customerName ?? <span className="text-xs text-ink-faint">見つかりません</span>}</Td> |
| `apps/web/src/app/friends/migrations/migrations-v8.tsx:223` | <p className={styles.stateTitle}>履歴はまだありません</p> |
| `apps/web/src/app/events/preview/page.tsx:139` | <p className="text-ink-faint mt-1 text-sm">選べる時間がありません。</p> |
| `apps/web/src/components/scenarios/question-editor.tsx:755` | <span className="text-ink-faint text-xs">タグがまだありません</span> |
| `apps/web/src/app/webhooks/sheets-v8.tsx:540` | <p className={styles.cardNote}>まだ同期の記録がありません。</p> |
| `apps/web/src/app/webhooks/_components/webhooks-v8-outgoing.tsx:527` | <p className={styles.stateBoxTitle}>まだ、送り先はありません</p> |
| `apps/web/src/app/webhooks/_components/webhooks-v8-outgoing.tsx:543` | <p className={styles.stateBoxTitle}>条件に合うものはありません</p> |
| `apps/web/src/app/notifications/page.tsx:269` | …=== 0 && !loading && !listFailed ? <p className="v8-ro-notifications-readNotice" role="status">未読のお知らせはありません。</p> : null} |
| `apps/web/src/components/merged-person/merged-profile-dialog.tsx:84` | <p className="text-xs leading-5 text-ink-faint">採用する値の候補はまだありません。</p> |
| `apps/web/src/app/mileage/friends/detail/v8-friend-detail.tsx:396` | <p className={styles.kpiSub}>{pendingItems.length > 0 ? \`${pendingItems.length}件が確定待ち\` : '確定待ちはありません'}</p> |
| `apps/web/src/app/mileage/friends/detail/v8-friend-detail.tsx:601` | <p className={styles.cellSub}>付与理由の記録はありません</p> |
| `apps/web/src/app/mileage/friends/detail/v8-friend-detail.tsx:616` | <p className={styles.cellSub}>交換の記録はありません</p> |
| `apps/web/src/app/events/bookings/page.tsx:329` | <p className="text-ink-faint mt-1 text-xs">繰上げや案内の履歴はまだありません。</p> |
| `apps/web/src/app/events/bookings/page.tsx:1165` | <p className="text-ink-faint text-sm">有効な開催回がありません。</p> |
| `apps/web/src/app/ec-commerce/order-drawer-v8.tsx:17` | …ide className="v8-ro-order-drawer" role="dialog" aria-modal="true" aria-labelledby={id} aria-busy={busy \|\| undefined} ref={ref} tabIndex={-1}><header><div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</di… |
| `apps/web/src/app/booking/staff/staff-edit-dialog.tsx:84` | <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="booking-staff-modal-title" className="bg-canvas rounded-card shadow-float w-full max-w-md max-h-[90vh] overflow-y-auto"> |
| `apps/web/src/app/webhooks/webhook-overviews.tsx:1059` | <p className="text-ink-secondary text-sm">いま確認が必要な届物はありません。</p> |
| `apps/web/src/app/webhooks/_components/webhooks-v8-incoming.tsx:998` | <p className={styles.panelLead}>いま確認が必要な届物はありません。</p> |
| `apps/web/src/app/ec-commerce/order-detail-drawer.tsx:254` | <p className={styles.cellSub}>届いた出来事はありません。</p> |
| `apps/web/src/app/ec-commerce/order-detail-drawer.tsx:267` | <p className={styles.cellSub}>予約されている案内はありません。</p> |
| `apps/web/src/app/ec-commerce/order-detail-drawer.tsx:297` | <p className={styles.cellSub}>この注文に結びついた成果・マイル・スコアはありません。</p> |
| `apps/web/src/app/automations/runs/page.tsx:605` | <p className="text-sm text-ink-secondary">この実行を見る権限がありません。</p> |
| `apps/web/src/app/automations/runs/page.tsx:658` | <p className="mt-2 text-sm text-ink-secondary">この実行を見る権限がありません。</p> |
| `apps/web/src/app/automations/runs/page.tsx:683` | <p className="mt-2 text-sm text-ink-faint">処理の記録はありません</p> |
| `apps/web/src/app/mileage/mileage-rewards-tab.tsx:479` | <p className="font-bold text-ink">ランクの使い道はまだありません</p> |
| `apps/web/src/app/mileage/v8-earning-rules-tab.tsx:697` | <p className={styles.stateTitle}>まだ、たまる決めごとはありません</p> |
| `apps/web/src/app/mileage/v8-earning-rules-tab.tsx:711` | <p className={styles.stateTitle}>条件に合う決めごとはありません</p> |
| `apps/web/src/app/common-actions/page.tsx:419` | …tem.name}>{item.name}</span>} sub={<span className="truncate" title={item.description ?? undefined}>{item.description \|\| '説明はありません'}</span>} /> |
| `apps/web/src/app/common-actions/common-actions-v8.tsx:340` | <p className={styles.cellSub} title={item.description ?? undefined}>{item.description \|\| '説明はありません'}</p> |
| `apps/web/src/app/automations/runs-v8.tsx:573` | <p className={styles.footnote}>この実行を見る権限がありません。</p> |
| `apps/web/src/app/automations/runs-v8.tsx:636` | <p className={styles.footnote}>この実行を見る権限がありません。</p> |
| `apps/web/src/app/automations/runs-v8.tsx:661` | <p className={styles.footnote}>処理の記録はありません</p> |
| `apps/web/src/app/booking/menus/page.tsx:1344` | <p className="text-ink-faint text-xs">利用できる設備がありません。設備設定で作成してください。</p> |
| `apps/web/src/components/friend-attributes-v2/tag-list-v2.tsx:223` | …p-4"><section ref={manualPanelRef} role="dialog" aria-modal="true" className={\`w-full max-w-[520px] rounded-card border border-hairline bg-canvas p-6 ${SHADOW}\`}><div className="flex items-start justify-between gap-3"><h… |
| `apps/web/src/components/friend-attributes-v2/tag-list-v2.tsx:225` | …p-4"><section ref={deletePanelRef} role="alertdialog" aria-modal="true" aria-labelledby="tag-delete-title" className={\`relative w-full max-w-[520px] rounded-card border border-hairline bg-canvas p-6 ${SHADOW}\`}><button t… |
| `apps/web/src/app/automations/page.tsx:250` | <span className="text-xs text-ink-faint">操作する権限がありません</span> |
| `apps/web/src/app/mileage/v8-rewards-tab.tsx:652` | <p className={styles.stateTitle}>使い道を見る権限がありません</p> |
| `apps/web/src/app/mileage/v8-rewards-tab.tsx:669` | <p className={styles.stateTitle}>まだ使い道がありません</p> |
| `apps/web/src/app/mileage/v8-rewards-tab.tsx:683` | <p className={styles.stateTitle}>条件に合う使い道はありません</p> |
| `apps/web/src/app/automations/list-v8.tsx:326` | <span className={styles.subLine}>操作する権限がありません</span> |
| `apps/web/src/components/friend-fields/tag-csv-import-dialog.tsx:172` | role="dialog" |
| `apps/web/src/components/friend-fields/tag-editor-v4.tsx:317` | …line bg-canvas p-7 shadow-overlay" role="alertdialog" aria-modal="true" aria-labelledby="tag-retroactive-title"> |
| `apps/web/src/components/friend-fields/tag-editor-v4.tsx:592` | …{actions.length === 0 ? <p className="rounded-control border border-dashed border-hairline p-5 text-center text-sm text-ink-faint">連動アクションはまだありません</p> : <div className="overflow-x-auto pb-1"><ol className="spa… |
| `apps/web/src/components/rich-menus/area-properties.tsx:495` | <p className="text-ink-faint mt-1 text-micro">タグがまだありません。</p> |
| `apps/web/src/components/friend-fields/edit-tag-page-v4.tsx:143` | <p className="mt-1 text-xs leading-5">保管済みのタグは、あとから元に戻す機能がありません。誤字などの表示名の訂正だけできます。フォルダ・付与のしかた・マイル・連動アクションなどの設定は変更できません。</p> |
| `apps/web/src/components/friend-fields/mark-list.tsx:113` | …airline bg-canvas shadow-overlay\`} role="alertdialog" aria-modal="true" aria-labelledby={titleId}> |
| `apps/web/src/app/automations/new/page.tsx:2122` | <p className="mb-3 text-xs text-ink-faint">合うきっかけがありません。言葉を変えるか、すべてのきっかけから選んでください。</p> |
| `apps/web/src/app/automations/new/page.tsx:2444` | …der-hairline bg-canvas-sunken p-3" role="dialog" aria-label="1人テストの確認"> |
| `apps/web/src/app/booking/menus/settings-tabs/holidays-tab.tsx:278` | <p className={styles.noteText}>臨時休業はまだありません。</p> |
| `apps/web/src/components/rich-menus/apply-to-tag-modal.tsx:138` | role="dialog" |
| `apps/web/src/components/update/progress-modal.tsx:124` | role="dialog" |
| `apps/web/src/components/support/email-thread.tsx:750` | role="dialog" |
| `apps/web/src/components/hq/members/member-dialog.tsx:158` | …{accounts.length === 0 ? <p className="text-caption text-ink-faint">アカウントがまだありません。</p> : null} |
| `apps/web/src/components/friend-fields/tags-page-v4.tsx:507` | …line bg-canvas p-7 shadow-overlay" role="alertdialog" aria-modal="true" aria-labelledby={titleId}> |
| `apps/web/src/app/automations/new/new-v8.tsx:2272` | <p className={styles.footnote}>合うきっかけがありません。言葉を変えるか、すべてのきっかけから選んでください。</p> |
| `apps/web/src/app/automations/new/new-v8.tsx:2531` | …<div className={styles.subBox} role="dialog" aria-label="1人テストの確認"> |
| `apps/web/src/components/broadcasts/broadcast-asset-manager.tsx:199` | …</article>)}{items.length === 0 && <div className="col-span-full rounded-card border border-dashed bg-canvas p-12 text-center text-sm text-ink-faint">まだ{meta.singular}テンプレートがありません。「{meta.singular}を作る」から追加してください。</div>}</… |
| `apps/web/src/app/booking/menus/settings-tabs/hours-tab.tsx:243` | <p className={styles.noteText}>設備はまだありません。</p> |
| `apps/web/src/components/hq/banners/image-detail-modal.tsx:99` | role="dialog" |
| `apps/web/src/components/hq/banners/image-detail-modal.tsx:168` | <p className="text-caption text-ink-faint">この統括にアカウントがありません。</p> |
| `apps/web/src/components/hq/banners/image-detail-modal.tsx:170` | <p className="text-caption text-ink-faint">当てはまるアカウントがありません。</p> |
| `apps/web/src/components/broadcasts/broadcast-form.tsx:486` | <p className="border-t border-hairline px-3 py-3 text-ink-faint">本文にURLはありません。</p> |
| `apps/web/src/components/broadcasts/broadcast-form.tsx:532` | {buttons.length === 0 && <p className="rounded-control bg-canvas-sunken p-3 text-xs text-ink-faint">ボタンはまだありません。</p>} |
| `apps/web/src/components/broadcasts/broadcast-form.tsx:2183` | )) : <p className="text-xs text-ink-faint">最近の配信はまだありません。</p>} |
| `apps/web/src/components/accounts/account-switcher.tsx:50` | …enter justify-center bg-scrim p-4" role="dialog" aria-modal="true" aria-labelledby="account-switch-title" onClick={onClose}> |
| `apps/web/src/app/booking/menus/new/menu-form-v8.tsx:1092` | <p className="text-ink-faint text-sm">このアカウントに使えるタグがありません。タグなしで保存できます。</p> |
| `apps/web/src/app/booking/menus/new/menu-form-v8.tsx:1158` | <p className="text-ink-faint mt-3 text-sm">使える設備はまだありません。受付枠の設備から登録できます。</p> |
| `apps/web/src/components/accounts/account-ordering.tsx:260` | …中…</p> : unassigned.length === 0 ? <p className="rounded-control bg-canvas px-3 py-4 text-center text-xs text-ink-faint">未設定はありません</p> : unassigned.map((account) => <div key={account.id} data-account-id={account.id} drag… |
| `apps/web/src/components/hq/banners/project-card.tsx:92` | <p className="truncate text-caption text-ink-faint">{project.description \|\| '説明はまだありません'}</p> |
| `apps/web/src/app/hq/billing/page.tsx:285` | <p className="px-4 py-5 text-caption text-ink-faint">まだ支払いはありません。プランを選ぶと、ここに請求と支払いの記録が並びます。</p> |
| `apps/web/src/app/chats/page.tsx:2228` | * role="dialog" の紙なのに Tab が裏の送信欄へ抜け、閉じても |
| `apps/web/src/app/chats/page.tsx:3186` | <p className="text-on-accent/60 text-sm">メッセージはまだありません。</p> |
| `apps/web/src/app/chats/page.tsx:3456` | role="dialog" |
| `apps/web/src/app/chats/page.tsx:3793` | role="dialog" |
| `apps/web/src/app/booking/menus/settings-v8.tsx:611` | <p className={styles.sideLineLink}>このアカウントには予約画面のURLがまだありません</p> |
| `apps/web/src/components/accounts/account-edit-modal.tsx:192` | role="dialog" |
| `apps/web/src/app/booking/menus/liff-phone-v8.tsx:149` | <p className={styles.phoneSub}>受付中のメニューはまだありません。</p> |
| `apps/web/src/app/booking/menus/liff-phone-v8.tsx:331` | <p className={styles.phoneSub}>この期間に空きはありません。</p> |
| `apps/web/src/components/forms/form-preview.tsx:190` | <p className="text-ink-faint text-xs">選択肢がまだありません</p> |
| `apps/web/src/app/webinars/edit/page.tsx:392` | {visible.length === 0 ? <p className="text-ink-faint p-8 text-center text-sm">この条件のアクションはまだありません。</p> : visible.map((action, index) => { |
| `apps/web/src/app/webinars/edit/page.tsx:402` | …rol border px-3 py-2 text-sm" /> : <span className="text-ink-faint text-xs">追加設定はありません</span>} |
| `apps/web/src/app/contents/media-preview-overlay.tsx:30` | role="dialog" |
| `apps/web/src/components/forms/options-sections.tsx:71` | <p className="text-ink-secondary mt-2 text-sm">実行することはまだありません</p> |
| `apps/web/src/app/contents/media-upload-dialog.tsx:206` | role="dialog" |
| `apps/web/src/app/broadcasts/list-v8.tsx:889` | …div className={styles.datePopover} role="dialog" aria-label="配信日で絞る"> |
| `apps/web/src/app/broadcasts/list-v8.tsx:1021` | <p className={styles.stateTitle}>配信を見る権限がありません</p> |
| `apps/web/src/app/broadcasts/list-v8.tsx:1035` | <p className={styles.stateTitle}>条件に合う配信はありません</p> |
| `apps/web/src/app/broadcasts/list-v8.tsx:1044` | <p className={styles.stateTitle}>まだ一斉配信はありません</p> |
| `apps/web/src/components/forms/options-dialog.tsx:59` | role="dialog" |
| `apps/web/src/components/forms/options-dialog.tsx:100` | <p className="text-ink-secondary mt-2 text-sm">実行することはまだありません</p> |
| `apps/web/src/app/broadcasts/detail-v8.tsx:759` | <p className={\`${styles.cardDesc} mt-3\`}>計測したボタン・リンクはありません。</p> |
| `apps/web/src/app/booking/bookings/page.tsx:1570` | <p className="text-warning mt-3 text-xs">{detail?.previousHandover ?? '前回の申し送りはありません。'}</p> |
| `apps/web/src/app/booking/bookings/page.tsx:1595` | …ap-4 border-t bg-canvas px-6 py-3"><p className="text-ink-faint text-xs">{isLinked ? 'ここでの状態変更は、お客様のLINEにも自動で知らせます。' : 'LINEと結びついていないため、お客様への自動連絡はありません。'}</p><div className="flex gap-2"><Button onClick={() => onAction('c… |
| `apps/web/src/app/pools/page.tsx:391` | role="dialog" |
| `apps/web/src/app/hq/support/page.tsx:350` | <p className="rounded-card border border-hairline bg-canvas px-4 py-4 text-caption text-ink-faint">まだ問い合わせはありません。</p> |
| `apps/web/src/app/broadcasts/detail/broadcast-recipients.tsx:153` | <p className="text-ink text-sm font-semibold">宛先ごとの結果はありません</p> |
| `apps/web/src/app/booking/bookings/detail/page.tsx:1091` | <p className="text-ink-faint text-sm">記入はありませんでした。</p> |
| `apps/web/src/app/booking/bookings/detail/page.tsx:1228` | <p className="text-ink-faint text-xs">確認が必要なことはありません。</p> |
| `apps/web/src/app/booking/bookings/detail/page.tsx:1398` | <p className="text-ink-faint text-xs">今後のお知らせはありません。</p> |
| `apps/web/src/app/booking/bookings/detail/page.tsx:1443` | <p className="text-ink-faint text-xs">通知履歴はありません。</p> |
| `apps/web/src/app/contents/vars/new/page.tsx:681` | role="alertdialog" |
| `apps/web/src/app/webinars/edit/comments-v8.tsx:192` | <p className="text-ink-faint mt-3 text-xs">まだコメントがありません。下の「追加」から足してください。</p> |
| `apps/web/src/app/templates/page.tsx:1452` | …overlay" style={{ maxWidth: 720 }} role="dialog" aria-modal="true" aria-labelledby="blocked-template-title"> |
| `apps/web/src/app/line-notifications/operator-notification-rules.tsx:187` | {showExport ? <div role="dialog" aria-modal="true" aria-label="CSVを書き出す理由" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4"><div ref={exportPanelRef} className="w-full max-w-md rounded-ca… |
| `apps/web/src/app/broadcasts/detail/page.tsx:951` | <p className="text-ink-faint bg-canvas-sunken mt-3 rounded-control p-3 text-xs">計測したボタン・リンクはありません。</p> |
| `apps/web/src/app/webinars/edit/cta-v8.tsx:417` | …Candidates.state === 'forbidden' ? <p className="text-ink-secondary mt-3 text-sm">回答フォームを見る権限がありません。管理者に権限の確認を依頼してください。</p> : null} |
| `apps/web/src/app/webinars/edit/cta-v8.tsx:418` | …' && publishedForms.length === 0 ? <p className="text-ink-faint mt-3 text-sm">公開中の回答フォームがありません。</p> : null} |
| `apps/web/src/app/webinars/edit/cta-v8.tsx:421` | …d === editor.registrationFormId) ? <p className="text-warning mt-2 text-sm">保存済みの申込フォームは公開中ではありません。</p> : null} |
| `apps/web/src/app/contents/vars/new/new-v8.tsx:629` | role="alertdialog" |
| `apps/web/src/app/booking/bookings/booking-calendar.tsx:717` | …ested === 0 && phoneCount === 0 && <p>いま確認が必要な予約はありません。</p>} |
| `apps/web/src/app/hq/support/detail/page.tsx:298` | <p className="px-4 py-4 text-caption text-ink-faint">まだ問い合わせはありません。</p> |
| `apps/web/src/app/templates/edit-v8.tsx:561` | <p className={styles.muted}>本文にURLはありません。</p> |
| `apps/web/src/app/templates/edit-v8.tsx:596` | <p className="text-ink-secondary mt-3 text-sm">違いは見つかりませんでした。そのまま読み込めます。</p> |
| `apps/web/src/app/webinars/edit/retention-section.tsx:108` | <p className="text-ink-faint mt-4 text-sm">まだ視聴データがありません</p> |
| `apps/web/src/app/contents/vars/edit/page.tsx:1133` | <p className="text-ink-faint mt-3 text-sm">まだ変更履歴はありません。</p> |
| `apps/web/src/app/contents/vars/edit/page.tsx:1200` | <p className="text-ink-faint p-4 text-sm">現在の使用先はありません。</p> |
| `apps/web/src/app/contents/vars/edit/page.tsx:1249` | <p className="text-success font-semibold">保存を止める問題は見つかりませんでした。</p> |
| `apps/web/src/app/contents/vars/edit/page.tsx:1273` | <p className="text-ink-faint mt-3 text-sm">{NOT_AVAILABLE}（すぐ変わる使用先の文はありません）</p> |
| `apps/web/src/app/contents/vars/edit/page.tsx:1327` | role="dialog" |
| `apps/web/src/app/contents/vars/edit/edit-v8.tsx:1061` | <p className={styles.cardNote}>まだ変更履歴はありません。</p> |
| `apps/web/src/app/contents/vars/edit/edit-v8.tsx:1263` | role="dialog" |
| `apps/web/src/app/contents/vars/edit/edit-v8.tsx:1491` | <span>文字数の上限をこえる文はありません。保存を止める問題は見つかりませんでした。</span> |
| `apps/web/src/app/hq/templates/template-console.tsx:391` | …es(search.toLocaleLowerCase())) && <p className={styles.empty}>{templates.length ? '検索に一致するひな形はありません。' : 'まだひな形がありません。最初のひな形を作成してください。'}</p>}</div> |
| `apps/web/src/app/hq/templates/template-console.tsx:461` | …></div>)}{!shownAccounts.length && <p className={styles.empty}>選択できるアカウントがありません。</p>} |
| `apps/web/src/app/templates/list-v8.tsx:1065` | <p className={styles.stateTitle}>条件に合うテンプレートはありません</p> |
| `apps/web/src/app/templates/list-v8.tsx:1079` | <p className={styles.stateTitle}>まだ{sectionWord}はありません</p> |
| `apps/web/src/app/nen-members/photo-review-v8.tsx:705` | <p className={styles.railNote}>今月に見送った写真はまだありません</p> |
| `apps/web/src/app/settings/feature-settings-v8.tsx:260` | role="dialog" |
| `apps/web/src/app/webinars/edit/video-v8.tsx:391` | <p className="text-ink-faint mt-3 text-xs">まだ枠がありません。下の「枠を足す」から足してください。</p> |
| `apps/web/src/app/nen-members/photo-policy-history-v8.tsx:84` | …licyContent(version)}</p></div>) : <p className={styles.railNote}>予約中の版はありません</p>}</section> |
| `apps/web/src/app/webinars/edit/analytics-details.tsx:15` | …{analytics.sessions.length === 0 ? <p className="text-ink-faint mt-2 text-xs">まだ開催回の視聴データがありません。</p> : <table className="mt-2 w-full table-fixed"> |
| `apps/web/src/app/webinars/edit/analytics-details.tsx:26` | …{analytics.daily.length === 0 ? <p className="text-ink-faint mt-2 text-xs">まだ日別のデータがありません。</p> : <table className="mt-2 w-full table-fixed"> |
| `apps/web/src/app/templates/detail/page.tsx:477` | <span className="text-ink-faint text-xs">開ける画面がありません</span> |
| `apps/web/src/app/nen-members/photo-publications.tsx:184` | {items.length === 0 && <p className="col-span-full rounded-control border border-hairline bg-canvas px-4 py-3 text-sm text-ink-faint">いま公式サイト掲載中の写真はありません。</p>} |
| `apps/web/src/app/nen-members/photo-publications.tsx:254` | …t.id)} placement={placement} />) : <span>掲載先の記録はありません</span>}</div> |
| `apps/web/src/app/webinars/edit/viewer-comments.tsx:33` | : comments.length === 0 ? <p className="text-ink-faint text-xs">まだコメントはありません。</p> |
| `apps/web/src/app/friend-add-settings/list-v8.tsx:538` | <p className={styles.stateTitle}>条件に合う設定はありません</p> |
| `apps/web/src/app/friend-add-settings/list-v8.tsx:561` | <p className={styles.stateTitle}>まだ経路ごとの初回案内はありません</p> |
| `apps/web/src/app/nen-members/photo-review-detail.tsx:217` | {risks.length === 0 ? <p className="mt-1 text-xs font-medium leading-relaxed text-ink-faint">注意候補はありません。公開の最終判断は人が行います。</p> : risks.map((risk, index) => <div key={\`${text(risk.flag)}-${index}\`} className="mt-3… |
| `apps/web/src/app/friend-add-settings/runs/runs-v8.tsx:478` | <p className={styles.stateTitle}>条件に合う実行結果はありません</p> |
| `apps/web/src/app/templates/detail/detail-v8.tsx:835` | <span>{row.kind}「{row.name}」（開ける画面がありません）</span> |
| `apps/web/src/app/friend-add-settings/editor-v8.tsx:707` | <p className={styles.cardDesc}>条件に合う流入リンクはありません。名前を変えて探してください。</p> |
| `apps/web/src/app/friend-add-settings/editor-v8.tsx:1136` | <p className={styles.cardDesc}>まだ何もありません。下から足せます。</p> |
| `apps/web/src/app/friend-add-settings/publish/page.tsx:354` | <p className={styles.note}>重なっている経路はありません。</p> |
| `apps/web/src/app/friend-add-settings/runs/detail/page.tsx:265` | <p className="mt-4 text-sm text-ink-secondary">実行した処理はありません。</p> |
| `apps/web/src/app/friend-add-settings/friend-add-rule-editor.tsx:619` | {windows.length === 0 && <p className={'friend-add-editor-helper'}>時間帯の制限はありません。</p>} |
| `apps/web/src/app/friend-add-settings/friend-add-rule-editor.tsx:722` | …nActions}>アクションを追加する</button></div><p>{definition.actions.length ? definition.actions.map((action) => action.label).join('／') : '追加のアクションはありません'}</p></div> |
| `apps/web/src/app/friend-add-settings/friend-add-rule-editor.tsx:750` | …nActions}>アクションを追加する</button></div><p>{definition.actions.length ? definition.actions.map((action) => action.label).join('／') : '追加のアクションはありません'}</p></div> |
| `apps/web/src/app/friend-add-settings/friend-add-rule-editor.tsx:763` | …{definition.actions.length === 0 ? <p>追加のアクションはありません。</p> : definition.actions.map((action, index) => <div key={\`${action.type}-${index}\`}><span>{index + 1}</span><strong>{action.label}</strong><IconButton aria-label={\`$… |
| `apps/web/src/app/conversions/new/conversion-create-v8.tsx:731` | <p className={styles.fieldNote}>使える{group.label}がまだありません</p> |
| `apps/web/src/app/conversions/new/page.tsx:517` | <p className="text-ink-faint mt-2 text-xs">使える{group.label}がまだありません</p> |
| `apps/web/src/app/emergency/page.tsx:1338` | …nter justify-center bg-ink/35 p-4" role="dialog" aria-modal="true" aria-labelledby="emergency-confirm-title"> |
| `apps/web/src/app/emergency/page.tsx:1356` | …nter justify-center bg-ink/50 p-4" role="dialog" aria-modal="true" aria-labelledby="emergency-step-up-title"> |
| `apps/web/src/app/emergency/page.tsx:1518` | …いません。</p> : entries.length === 0 ? <p className="p-8 text-center text-xs text-ink-faint">この期間の記録はありません。</p> : <><div className="hidden grid-cols-[170px_1.2fr_1fr_1fr_100px] gap-3 bg-canvas-sunken px-4 py-3 text-micro fon… |
| `apps/web/src/app/emergency/page.tsx:1522` | …{recentUpdates.length === 0 ? <p className="p-8 text-center text-xs text-ink-faint">更新の記録はありません。</p> : <div className="divide-y divide-hairline">{recentUpdates.map((entry, index) => <div key={\`${entry.version}-${ent… |
| `apps/web/src/app/tags/searches-v8.tsx:334` | <p className={styles.stateTitle}>保存した検索を見る権限がありません</p> |
| `apps/web/src/app/tags/searches-v8.tsx:351` | <p className={styles.stateTitle}>まだ保存した検索がありません</p> |
| `apps/web/src/app/tags/searches-v8.tsx:357` | <p className={styles.stateTitle}>条件に合う保存した検索はありません</p> |
| `apps/web/src/app/search-console/page.tsx:75` | <p className="text-ink-faint p-8 text-center text-sm">データがありません</p> |
| `apps/web/src/app/rich-menus/list-v8.tsx:840` | <p className={styles.stateTitle}>条件に合うメニューはありません</p> |
| `apps/web/src/app/rich-menus/list-v8.tsx:851` | <p className={styles.stateTitle}>まだリッチメニューはありません</p> |
| `apps/web/src/app/tags/edit-tag-page-v8.tsx:302` | <p className="text-ink-secondary mt-3 text-sm">違いは見つかりませんでした。そのまま読み込めます。</p> |
| `apps/web/src/app/tags/marks-v8.tsx:369` | <p className={styles.stateTitle}>対応マークを見る権限がありません</p> |
| `apps/web/src/app/tags/marks-v8.tsx:386` | <p className={styles.stateTitle}>まだ対応マークがありません</p> |
| `apps/web/src/app/tags/marks-v8.tsx:391` | <p className={styles.stateTitle}>条件に合う対応マークはありません</p> |
| `apps/web/src/app/tags/tags-tab-v8.tsx:683` | <p className={styles.stateTitle}>タグを見る権限がありません</p> |
| `apps/web/src/app/tags/tags-tab-v8.tsx:700` | <p className={styles.stateTitle}>まだタグがありません</p> |
| `apps/web/src/app/tags/tags-tab-v8.tsx:705` | <p className={styles.stateTitle}>条件に合うタグはありません</p> |
| `apps/web/src/app/conversions/conversion-points-v8.tsx:410` | <p className={styles.stateBoxTitle}>まだ成果地点がありません</p> |
| `apps/web/src/app/conversions/conversion-points-v8.tsx:426` | <p className={styles.stateBoxTitle}>条件に合うものはありません</p> |
| `apps/web/src/app/nen/health/health-v8.tsx:511` | …div className={styles.drawerPanel} role="dialog" aria-modal="true" aria-label="健康日記 30日のまとめ"> |
| `apps/web/src/app/tags/fields-tab-v8.tsx:451` | <p className={styles.stateTitle}>友だち情報欄を見る権限がありません</p> |
| `apps/web/src/app/tags/fields-tab-v8.tsx:468` | <p className={styles.stateTitle}>まだ友だち情報欄がありません</p> |
| `apps/web/src/app/tags/fields-tab-v8.tsx:473` | <p className={styles.stateTitle}>条件に合う項目はありません</p> |
| `apps/web/src/app/nen/health/summary-drawer.tsx:103` | <p className="mt-1 text-caption text-ink-faint">メモはありません</p> |
| `apps/web/src/app/tags/search-editor-v8.tsx:898` | <p className={styles.noteText}>条件はまだありません。必要な場合だけ追加します。</p> |
| `apps/web/src/app/tags/search-editor-v8.tsx:1008` | <p className={styles.noteText} style={{ fontWeight: 600 }}>使用先はありません</p> |
| `apps/web/src/app/tags/tag-editor-v8.tsx:361` | <p className={styles.emptyBox}>連動アクションはまだありません</p> |
| `apps/web/src/app/rich-menus/new/create-v8.tsx:1823` | if (!activePage) return <div className={styles.stateCard}>ページがありません</div> |
| `apps/web/src/app/rich-menus/new/create-v8.tsx:1885` | <span className={styles.cardNote}>まだ画像がありません</span> |
| `apps/web/src/app/rich-menus/new/create-v8.tsx:2046` | <p className={styles.cardNote}>ほかの出し分けメニューはありません。</p> |
| `apps/web/src/app/tags/folders/new/page.tsx:188` | role="dialog" |
| `apps/web/src/app/tags/folders/new/page.tsx:203` | <p className="text-ink-secondary text-sm">見る権限がありません</p> |
| `apps/web/src/app/rich-menus/connections/page.tsx:176` | <p className="text-ink text-lg font-bold">まだ切替先がありません</p> |
| `apps/web/src/app/rich-menus/connections/page.tsx:202` | …tab}</div> })}</div>{lacksReturn ? <p className="text-danger mt-3 text-xs font-semibold">トップへ戻るタブがありません</p> : <p className="text-accent-deep mt-3 flex items-center gap-1 text-xs"><CircleCheck size={13} />戻り道を確認済み</p>}</a… |
| `apps/web/src/app/restaurant-test/restaurant-console.tsx:498` | …ngth === 0 && <Panel title="承認キュー"><p className="p-8 text-center text-sm text-ink-faint">承認待ちはありません。</p></Panel>}</div> |
| `apps/web/src/app/restaurant-test/restaurant-console.tsx:612` | …></DataTable>{rows.length === 0 && <p className="p-8 text-center text-sm text-ink-faint">条件に合う予約はありません。</p>}<div className="flex justify-center p-4"><Pagination page={page} pageCount={pageCount} onPageChange={(next) => o… |
| `apps/web/src/app/updates/page.tsx:90` | <p className="text-ink-faint text-sm">履歴はまだありません。</p> |
| `apps/web/src/app/nen/pets/pets-v8.tsx:866` | …<div className={styles.dialog} role="dialog" aria-modal="true" aria-label="ペットの情報を直す"> |
| `apps/web/src/app/rich-menus/edit/page.tsx:1264` | <p className="text-sm text-ink-faint">ページがありません</p> |
| `apps/web/src/app/rich-menus/edit/page.tsx:2198` | <p className="text-ink-faint mt-2 text-xs">まだ公開予約はありません。日時を決めて予約するとここに出ます。</p> |
| `apps/web/src/app/inflow-links/referral-qr-modal.tsx:80` | <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} data-design-node="GtI4Y" className="w-full max-w-md rounded-card bg-canvas p-6 shadow-overlay"> |
| `apps/web/src/app/tags/searches/edit/page.tsx:485` | {items.length === 0 ? <p className="mt-2 text-xs text-ink-faint">条件はまだありません。必要な場合だけ追加します。</p> : null} |
| `apps/web/src/app/tags/searches/edit/page.tsx:937` | <p className="mt-3 text-sm font-semibold text-ink-secondary">使用先はありません</p> |
| `apps/web/src/app/restaurant-test/v8/reservations.tsx:466` | <p className={ledger.inlineNote}>この日の残りの予約はありません。</p> |
| `apps/web/src/app/restaurant-test/v8/reservations.tsx:796` | {rows.length === 0 ? <p className="p-8 text-center text-sm text-ink-faint">条件に合う予約はありません。</p> : null} |
| `apps/web/src/app/rich-menus/edit/publish-history.tsx:284` | <p className="text-ink-faint">いま対象に出ている版はありません（まだ公開に成功していません）。</p> |
| `apps/web/src/app/rich-menus/edit/publish-history.tsx:300` | <p className="text-ink-faint mt-3 text-xs">まだ公開の履歴はありません。</p> |
| `apps/web/src/app/inflow-links/page.tsx:1017` | …div className={styles.presetPanel} role="dialog" aria-label="よく使う絞り込み"> |
| `apps/web/src/app/restaurant-test/google/google-performance.tsx:161` | <p className="text-ink-secondary text-sm">Google提供の集計値です。最新データには遅れがあります。電話のクリック数は、通話成立数ではありません。</p> |
| `apps/web/src/app/restaurant-test/google/google-performance.tsx:204` | <p className="text-ink-faint text-xs">未取得・未対応は「—」で表示し、0件と区別します。表示数は区分別の合計であり、実来店数ではありません。</p> |
| `apps/web/src/app/restaurant-test/v8/inventory-channels.tsx:96` | <p className="text-sm text-ink-secondary">いま残っているものはありません。</p> |
| `apps/web/src/app/restaurant-test/v8/inventory-channels.tsx:118` | <p className="text-sm text-ink-secondary">つないでいる媒体はまだありません。</p> |
| `apps/web/src/app/restaurant-test/google/google-profile.tsx:239` | …{data.holidays.length === 0 ? <p className="text-ink-secondary text-sm">今後30日に祝日はありません。</p> : ( |
| `apps/web/src/app/restaurant-test/google/google-profile.tsx:323` | <p className="text-ink-secondary text-sm leading-relaxed">{data.googleUpdates ? 'Google側からの営業時間やプロフィールの変更提案は、いまはありません。' : 'Google側の変更提案を取得できませんでした。同期すると再確認します。'}</p> |
| `apps/web/src/app/restaurant-test/google/google-profile.tsx:706` | …{weeklyChanged.length === 0 ? <p className="text-ink-faint text-sm">まだ変更はありません。</p> : weeklyChanged.map((d) => { const [b, a] = periodDiff(profile.regularHours[d] ?? [], weekly[d] ?? []); return <p key={d} className… |
| `apps/web/src/app/restaurant-test/google/google-profile.tsx:907` | {isHours ? <p className={\`text-sm ${change.reservationImpactCount > 0 ? 'text-status-warn-deep font-semibold' : 'text-ink-secondary'}\`}>{change.reservationImpactCount > 0 ? \`予約への影響：変更後の営業時間の外に始まる予約が ${change.rese… |
| `apps/web/src/app/restaurant-test/google/google-profile.tsx:1217` | …ror && picker.items.length === 0 ? <p className="text-ink-secondary text-sm">このLINEアカウントの登録メディアに画像がありません。先に「登録メディア」で画像を追加してください。</p> : null} |
| `apps/web/src/app/scenarios/list-v8.tsx:773` | <p className={styles.stateTitle}>条件に合うシナリオはありません</p> |
| `apps/web/src/app/scenarios/list-v8.tsx:783` | <p className={styles.stateTitle}>まだシナリオはありません</p> |
| `apps/web/src/app/affiliates/v8-shared.tsx:160` | <p className="af-list-stateTitle">条件に合うものはありません</p> |
| `apps/web/src/app/restaurant-test/google/google-posts.tsx:491` | …ror && picker.items.length === 0 ? <p className="text-ink-secondary text-sm">このLINEアカウントの登録メディアに画像がありません。先に「登録メディア」で画像を追加してください。</p> : null} |
| `apps/web/src/app/inflow-links/_components/inflow-delete-dialog.tsx:94` | …k/35 p-4" data-design-node="UIaM7" role="dialog" aria-modal="true" aria-labelledby="inflow-delete-title"> |
| `apps/web/src/app/affiliates/offer-terms.tsx:341` | <p className="text-ink-faint mt-1 text-xs">まだ履歴がありません</p> |
| `apps/web/src/app/affiliates/tabs.tsx:995` | <p className="text-ink-faint mt-4 text-sm">この方には、今回締められる報酬がありません。</p> |
| `apps/web/src/app/affiliates/tabs.tsx:2533` | …d border-hairline mt-3 border p-4" role="dialog" aria-label="成果の詳細"> |
| `apps/web/src/app/affiliates/tabs.tsx:2761` | <span className="text-ink-faint mt-0.5 block max-w-[300px] truncate text-xs">{offer.description ?? '説明はありません'}</span> |
| `apps/web/src/app/inflow-links/_components/create-genre-modal.tsx:51` | <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-card bg-canvas p-6 shadow-overlay"> |
| `apps/web/src/app/restaurant-test/v8/reservation-phone.tsx:251` | …{candidates.length === 0 ? <p className={ledger.inlineNote}>台帳に見つかりません。電話番号のタブから入れられます。</p> : null} |
| `apps/web/src/app/inflow-links/detail/page.tsx:849` | …k/35 p-4" data-design-node="UIaM7" role="dialog" aria-modal="true" aria-labelledby="inflow-delete-title"> |
| `apps/web/src/app/affiliates/action-dialogs.tsx:295` | …overlay" style={{ maxWidth: 800 }} role="dialog" aria-modal="true" aria-labelledby="affiliate-payment-title"> |
| `apps/web/src/app/affiliates/v8-drawer.tsx:218` | role="dialog" |

## 骨格の行

検索候補：4 行。

|場所|該当箇所（長い行は抜粋）|
|---|---|
| `apps/web/src/app/health/page.tsx:313` | …nfig.color} ${risk === 'danger' ? 'animate-pulse' : ''}\`} /> |
| `apps/web/src/app/health/page.tsx:387` | …r} ${log.riskLevel === 'danger' ? 'animate-pulse' : ''}\`} /> |
| `apps/web/src/components/chats/friend-info-sidebar.tsx:818` | …<div className="p-4 space-y-3 animate-pulse"> |
| `apps/web/src/components/chats/friend-info-sidebar.tsx:904` | …ing skeleton={<div className="h-24 animate-pulse rounded-card bg-shell" />} /> |

## LINEの見え方

検索候補：10 行。

|場所|該当箇所（長い行は抜粋）|
|---|---|
| `apps/web/src/components/scenarios/step-preview.tsx:198` | /** 実際の友だち情報を作らず、LINEプレビューだけ安全な例へ置き換える。 */ |
| `apps/web/src/components/chats/template-picker.tsx:525` | …e="mt-3 min-h-[250px] rounded-card bg-line-talk p-5 shadow-card"> |
| `apps/web/src/components/webinars/webinar-line-preview.tsx:4` | * LINEプレビュー（設計 \`PV1Vh\` \`d3rFGD\` \`Ho8z4\` の右側）。 |
| `apps/web/src/app/booking/bookings/new/page.tsx:939` | // N-390: 未連携の電話客へLINEプレビューを見せると |
| `apps/web/src/app/friend-add-settings/friend-add-rule-editor.tsx:811` | const linePreview = noneMode |
| `apps/web/src/app/friend-add-settings/friend-add-rule-editor.tsx:814` | …ctions.length}件</strong></>}</div>{linePreview}</aside> |
| `apps/web/src/components/broadcasts/broadcast-form.tsx:2130` | …<dd className="text-ink-secondary">LINEプレビュー確認済み</dd></div> |
| `apps/web/src/components/broadcasts/broadcast-form.tsx:2580` | …r(bubbles) \|\| (previewConfirmed ? 'LINEプレビュー確認済み' : 'LINEプレビューが未確認です')}\`, done: !bubblesError(bubbles) && previewConfirmed, move: 'メッセージへ戻る' }, |
| `apps/web/src/components/broadcasts/broadcast-form.tsx:2637` | …iewConfirmed}>{previewConfirmed ? 'LINEプレビュー確認済み' : 'LINEプレビューが未確認です'}</Checkbox> |
| `apps/web/src/components/broadcasts/broadcast-form.tsx:2869` | …{previewConfirmed ? null : <li>LINEプレビューが未確認です</li>} |
