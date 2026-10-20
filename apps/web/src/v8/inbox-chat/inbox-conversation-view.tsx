'use client'
import ChatThreadWindow from '@/components/chats/chat-thread-window';
import { type ChatStatus } from '@/components/chats/inbox-dropdown';
import FlexPreviewComponent from '@/components/flex-preview';
import Button from '@/components/shared/button';
import Dialog from '@/components/shared/dialog';
import { InboxFlexContent, InboxMedia } from '@/components/shared/inbox-content';
import { InboxHistoryButton } from '@/components/shared/inbox-list';
import { InboxMessage, InboxMessageDay, InboxQuotedMessage } from '@/components/shared/inbox-thread';
import ListState from '@/components/shared/list-state';
import EmailThread from '@/components/support/email-thread';
import { InboxConversationPane, InboxMessages } from '@/components/templates/inbox-page';
import { formatDateTime, formatTime } from '@/lib/format';
import { InboxAiDraft, InboxAiHeadMenu, InboxAiSummary } from '@/v8/ai-reply/public/inbox-ai/index'
import AttachmentMessage from '@/v8/inbox-chat/attachment-message';
import ConversationHead from '@/v8/inbox-chat/conversation-head';
import { formatInboxListTime } from '@/v8/inbox-chat/list-time';
import { ChatSearchBar } from '@/v8/inbox-search/public/chat-search-bar/index'
import { Link2 } from 'lucide-react';
import { AUTO_SOURCE_LABEL, CORRECTION_TEMPLATE, Chat, formatByteSize, formatDayJa, formatInboxDatetime, formatYmdSlash, sameYmd } from './inbox-model';
import { ChatImageMessage, StickerMessageImage } from "./screen-gap-parts";

import type { Props } from './inbox-conversation-view-types';
import InboxReplyComposer from './inbox-reply-composer';

export default function InboxConversation({ operators, selectedChatId, selectedThreadId, setSelectedThreadId, showFriendInfo, setShowFriendInfo, loadEmails, deepLinkNotice, clearDeepLink, detailLoading, chatDetail, setSelectedChatId, attentionSaving, handleAttentionUpdate, handleOperatorUpdate, handleStatusUpdate, chatSearch, openChatSearch, inboxAi, selectedAccountId, chatSearchFocusSeq, chatSearchFilling, messagesScrollRef, messagesHasMore, loadingOlderMessages, loadOlderMessages, chatSearchTarget, setQuotedMessage, textareaRef, staffRole, setCorrectingId, setMessageContent, unseenIncoming, setUnseenIncoming, dropOver, setDropOver, handlePickAttachment, chatPollStalled, setChatPollRetryKey, setShowTemplatePicker, showComposerOptions, setShowComposerOptions, showMemoEditor, setShowMemoEditor, sendMode, setSendMode, memoPopoverRef, memoDraft, setMemoDraft, memoError, closeMemoEditor, handleSaveMemo, memoSaving, quotedMessage, pendingImage, setImagePreviewOpen, pendingImageMeta, imageInputRef, imageUploading, clearPendingImage, pendingAttachment, sending, scheduling, clearPendingAttachment, retryAttachment, messageContent, handleKeyDown, isComposingRef, messageOverLimit, messageLength, imageError, senderId, setSenderId, setShowSchedulePanel, showSchedulePanel, scheduledSends, handleSendMessage, scheduleInput, setScheduleInput, handleScheduleSend, error, scheduledSendsFailed, loadScheduledSends, handleReschedule, handleCancelScheduled, showTemplatePicker, setPendingPack, pendingPack, handleSendPack, imagePreviewOpen }: Props) {
  return (<InboxConversationPane data-inbox-v4="talk-pane" selected={Boolean(selectedChatId || selectedThreadId)}>
    {selectedThreadId ? (
      /* メールの往復。LINEのトークと同じ場所に出す。 */
      <EmailThread
        threadId={selectedThreadId}
        onBack={() => setSelectedThreadId(null)}
        customerInfoOpen={showFriendInfo}
        onOpenCustomerInfo={() => setShowFriendInfo(true)}
        onCloseCustomerInfo={() => setShowFriendInfo(false)}
        onChanged={() => {
          void loadEmails()
        }}
      />
    ) : deepLinkNotice ? (
      // URL指定の会話が開けなかったときの空状態。別人は開かず、
      // 理由と戻り先だけ出す(#673)。不正IDではselectedChatIdがnullに
      // なるため、通常の「選択してください」より先に判定する。
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="text-ink text-sm font-semibold">会話を開けませんでした</p>
          <p className="text-ink-secondary mt-2 text-sm leading-relaxed">{deepLinkNotice}</p>
          <Button onClick={clearDeepLink} className="mt-4">
            受信箱の一覧へ戻る
          </Button>
        </div>
      </div>
    ) : !selectedChatId ? (
      <ListState kind="empty" emptyPreset="readonly" title="会話を選ぶと、ここに表示されます" description="左の一覧から選んでください。「要返信」で、まだ返していない会話だけに絞れます。" />
    ) : detailLoading ? (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-ink-faint text-sm">読み込み中...</p>
      </div>
    ) : chatDetail ? (
      <>
        {/* Chat Header */}
        {/*
                U008: 狭い幅では「戻る・顔・名前」を1行目いっぱいに取り、
                操作（注目・担当・対応・顧客情報）は2行目へ折り返す。
                操作が同じ行にいると 390px で宛先の名前が潰れて、
                誰への返信か読めなかった。640px 以上では従来どおり1行。
              */}
        {(
          /*
           * ★V8 会話の頭（XqSvX）：顔28・名前15・補足、右に ☆・担当・対応状況・探す・右の列の出し入れ。
           * メールの会話も同じ部品（ConversationHead）を使う。動き（注目・担当・対応・探す・開閉）は同じ処理を呼ぶ。
           */
          <ConversationHead
            name={chatDetail.friendName}
            pictureUrl={chatDetail.friendPictureUrl}
            sub={`${chatDetail.friendRealName ? `${chatDetail.friendRealName}・` : ''}LINE・${formatInboxListTime(chatDetail.lastMessageAt)}`}
            subTitle={`${chatDetail.friendRealName ? `${chatDetail.friendRealName}・` : ''}LINE・最終受信 ${formatInboxDatetime(chatDetail.lastMessageAt)}`}
            onBack={() => setSelectedChatId(null)}
            attention={{ on: Boolean(chatDetail.isAttention), saving: attentionSaving, onToggle: () => void handleAttentionUpdate() }}
            operator={{
              value: chatDetail.operatorId ?? 'unassigned',
              operators,
              onChange: (next) => { void handleOperatorUpdate(next === 'unassigned' ? null : next) },
            }}
            status={{ value: chatDetail.status as ChatStatus, onChange: (next) => void handleStatusUpdate(next as Chat['status']) }}
            search={{ open: chatSearch.open, onToggle: () => (chatSearch.open ? chatSearch.close() : openChatSearch()) }}
            panel={{ open: showFriendInfo, onToggle: () => setShowFriendInfo((current) => !current) }}
            extra={<InboxAiHeadMenu inboxAi={inboxAi} accountId={selectedAccountId} />}
          />
        )}
        <InboxAiSummary inboxAi={inboxAi} />

        {chatSearch.open && (
          <ChatSearchBar search={chatSearch} focusSeq={chatSearchFocusSeq} busy={chatSearchFilling} />
        )}

        {/* Messages — LINE-style chat bubbles */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* 板 `M0393`：会話の地は surface-pearl（LINE青の地は使わない）。 */}
          {/*
                2026-10-07 速さ：吹き出しは下から積む窓分け（ChatThreadWindow）。
                見ている位置は窓分けの側で守るので、ブラウザの自動の位置合わせは切る
                （二重に直すと飛ぶ）。行の間 8px は行の中に持つので space-y は付けない。
              */}
          <InboxMessages ref={messagesScrollRef} data-inbox-search-scope="">
            {/*
                  古い履歴の続き。直近100件だけ読んでいる会話で出す。
                  押すと今見えている最古の1件より古い分を上に足す。
                */}
            {messagesHasMore && (chatDetail.messages?.length ?? 0) > 0 && (
              <div className="flex justify-center pb-1">
                <InboxHistoryButton context="thread" busy={loadingOlderMessages}
                  onClick={() => { void loadOlderMessages() }}
                >
                  前のメッセージ
                </InboxHistoryButton>
              </div>
            )}
            {(!chatDetail.messages || chatDetail.messages.length === 0) ? (
              <div className="text-center py-8">
                <p className="text-on-accent/60 text-sm">メッセージはまだありません。</p>
              </div>
            ) : (
              <ChatThreadWindow
                key={chatDetail.id}
                messages={chatDetail.messages ?? []}
                scrollerRef={messagesScrollRef}
                hasMore={messagesHasMore}
                loadingOlder={loadingOlderMessages}
                onLoadOlder={() => { void loadOlderMessages() }}
                label={`${chatDetail.friendName}さんとのメッセージ`}
                total={chatDetail.total}
                scrollToId={chatSearchTarget?.id ?? null}
                scrollSeq={chatSearchTarget?.seq ?? 0}
                rowGap={'var(--tpl-inbox-thread-gap)'}
                renderMessage={(msg, idx, list) => {
                  const prevMsg = idx > 0 ? list[idx - 1] : null
                  const isLast = idx === list.length - 1
                  const showDateSep = !prevMsg || !sameYmd(prevMsg.createdAt, msg.createdAt)
                  const isOutgoing = msg.direction === 'outgoing'
                  const searchHit = chatSearch.hitKind(msg)

                  // メッセージ表示の分岐
                  let bubbleContent: React.ReactNode
                  if (msg.isUnsent) {
                    bubbleContent = <span className="text-ink-faint">送信を取り消しました</span>
                  } else if (msg.messageType === 'flex') {
                    bubbleContent = (
                      <InboxFlexContent>
                        <FlexPreviewComponent content={msg.content} maxWidth={280} />
                      </InboxFlexContent>
                    )
                  } else if (msg.messageType === 'image') {
                    // INBOX-30: 404・期限切れ・回線断は空白にせず、
                    // 理由の出る代替表示と読み込み直しに倒す。
                    bubbleContent = <ChatImageMessage content={msg.content} />
                  } else if (msg.messageType === 'sticker') {
                    bubbleContent = <StickerMessageImage content={msg.content} />
                  } else if ((msg.messageType === 'video' || msg.messageType === 'file') && msg.direction === 'outgoing') {
                    // ：送った動画・ファイルは JSON のまま出さず、再生できる枠・名前と期限の札にする。
                    bubbleContent = <AttachmentMessage messageType={msg.messageType} content={msg.content} />
                  } else {
                    bubbleContent = <span>{msg.content}</span>
                  }

                  if (msg.source === 'scenario') {
                    const startedAt = formatDateTime(msg.createdAt)
                    return (
                      <>
                        {showDateSep && (
                          <div className="mb-3 flex justify-center" style={{ marginTop: idx === 0 ? 12 : 4 }}>
                            <span className="bg-ink/20 text-on-accent/85 rounded-pill px-2.5 py-0.5 text-micro">
                              {formatYmdSlash(msg.createdAt)}
                            </span>
                          </div>
                        )}
                        {/* 上下の 8px は窓分けの行が持つ（外の余白は測った高さに入らない）。 */}
                        <div className="flex items-center justify-center gap-1.5" style={{ marginTop: !showDateSep && idx === 0 ? 8 : 0, marginBottom: isLast ? 8 : 0 }}>
                          <span className="inline-flex items-center gap-1 rounded-pill bg-canvas/90 px-3 py-1 text-micro font-semibold text-action shadow-card">
                            <Link2 aria-hidden="true" size={13} />
                            シナリオ「{msg.scenarioName ?? '名称未設定'}」を開始
                          </span>
                          <time className="text-micro text-ink-faint">{startedAt}</time>
                        </div>
                      </>
                    )
                  }

                  {
                    /*
                     * ★V8 やりとり（XqSvX「やりとり」）：日付は真ん中の小さな字、相手の吹き出しは白・薄い枠で
                     * 顔を置かない、時刻は吹き出しの横（相手は右・こちらは左）、こちらの吹き出しは薄い緑で
                     * 下に「K Kenta が送信」／「自動：…」。引用・探すの印・取り消しの扱いは 管理画面 と同じ。
                     */
                    const quotedNode = msg.quoted ? (
                      <InboxQuotedMessage>
                        {msg.quoted.isUnsent
                          ? '取り消されたメッセージ'
                          : msg.quoted.messageType === 'text'
                            ? msg.quoted.content
                            : `[${msg.quoted.messageType}]`}
                      </InboxQuotedMessage>
                    ) : null
                    const autoLabel = AUTO_SOURCE_LABEL[msg.source ?? ''] ?? null
                    return <>
                      {showDateSep ? <InboxMessageDay first={idx === 0}>{formatDayJa(msg.createdAt)}</InboxMessageDay> : null}
                      <InboxMessage outgoing={isOutgoing} last={isLast} time={formatTime(msg.createdAt)} searchHit={searchHit} senderName={msg.sentByStaffName} autoLabel={autoLabel}
                        onQuote={msg.isUnsent ? undefined : () => { setQuotedMessage(msg); textareaRef.current?.focus() }}
                        onCorrect={staffRole !== 'viewer' && isOutgoing && msg.messageType === 'text' && !msg.isUnsent && msg.source !== 'scenario'
                          ? () => { setQuotedMessage(msg); setCorrectingId(msg.id); setMessageContent((prev) => prev.trim() ? prev : CORRECTION_TEMPLATE); textareaRef.current?.focus() }
                          : undefined}>
                        {quotedNode}{bubbleContent}
                      </InboxMessage>
                    </>
                  }
                }}
              />
            )}
          </InboxMessages>
          {/*
                INBOX-27: 読み返している途中に下へ届いた新着は、位置を
                動かさず件数の目印だけ出す。押すと新しい方へ移る。
              */}
          {unseenIncoming > 0 && (
            <button
              type="button"
              onClick={() => {
                const el = messagesScrollRef.current
                if (el) el.scrollTop = el.scrollHeight
                setUnseenIncoming(0)
              }}
              className="bg-canvas/95 text-action absolute bottom-3 left-1/2 -translate-x-1/2 rounded-pill px-3 py-1.5 text-xs font-semibold shadow-card"
            >
              新着 {unseenIncoming} 件
            </button>
          )}
        </div>

        {/*
                入力欄（設計 `Reply`）。3段。

                  上: テンプレート・送信設定・内部メモ
                  中: メッセージを入力
                  下: 改行案内、画像は JPEG / PNG、1枚 10MB まで …… 送信

                以前は送信キーの設定・入力中ローディング・画像の投入枠が
                すべて出しっぱなしで、入力欄が縦に伸びてトークが読めなかった。
                よく使うものだけ出し、設定は畳む。
              */}
        <InboxAiDraft inboxAi={inboxAi} onInsert={(text) => { setMessageContent(text); textareaRef.current?.focus() }} />
        <InboxReplyComposer
          dropOver={dropOver}
          setDropOver={setDropOver}
          handlePickAttachment={handlePickAttachment}
          chatPollStalled={chatPollStalled}
          setChatPollRetryKey={setChatPollRetryKey}
          setShowTemplatePicker={setShowTemplatePicker}
          showComposerOptions={showComposerOptions}
          setShowComposerOptions={setShowComposerOptions}
          showMemoEditor={showMemoEditor}
          setShowMemoEditor={setShowMemoEditor}
          sendMode={sendMode}
          setSendMode={setSendMode}
          memoPopoverRef={memoPopoverRef}
          memoDraft={memoDraft}
          setMemoDraft={setMemoDraft}
          memoError={memoError}
          closeMemoEditor={closeMemoEditor}
          handleSaveMemo={handleSaveMemo}
          memoSaving={memoSaving}
          chatDetail={chatDetail}
          quotedMessage={quotedMessage}
          setQuotedMessage={setQuotedMessage}
          pendingImage={pendingImage}
          setImagePreviewOpen={setImagePreviewOpen}
          pendingImageMeta={pendingImageMeta}
          imageInputRef={imageInputRef}
          imageUploading={imageUploading}
          clearPendingImage={clearPendingImage}
          pendingAttachment={pendingAttachment}
          sending={sending}
          scheduling={scheduling}
          clearPendingAttachment={clearPendingAttachment}
          retryAttachment={retryAttachment}
          textareaRef={textareaRef}
          messageContent={messageContent}
          setMessageContent={setMessageContent}
          handleKeyDown={handleKeyDown}
          isComposingRef={isComposingRef}
          messageOverLimit={messageOverLimit}
          messageLength={messageLength}
          selectedChatId={selectedChatId}
          imageError={imageError}
          staffRole={staffRole}
          selectedAccountId={selectedAccountId}
          senderId={senderId}
          setSenderId={setSenderId}
          setShowSchedulePanel={setShowSchedulePanel}
          showSchedulePanel={showSchedulePanel}
          scheduledSends={scheduledSends}
          handleSendMessage={handleSendMessage}
          scheduleInput={scheduleInput}
          setScheduleInput={setScheduleInput}
          handleScheduleSend={handleScheduleSend}
          error={error}
          scheduledSendsFailed={scheduledSendsFailed}
          loadScheduledSends={loadScheduledSends}
          handleReschedule={handleReschedule}
          handleCancelScheduled={handleCancelScheduled}
          showTemplatePicker={showTemplatePicker}
          setPendingPack={setPendingPack}
          pendingPack={pendingPack}
          handleSendPack={handleSendPack}
        />

        {/* INBOX-32: 添付画像を大きく確かめる窓。背景か Esc 相当の閉じるで戻る。 */}
        {imagePreviewOpen && pendingImage && pendingImage.mode === 'line-image' ? (
          <Dialog open title="添付した画像の確認" onCancel={() => setImagePreviewOpen(false)} designWidth={800}>
            <InboxMedia kind="preview" src={pendingImage.originalContentUrl} alt={pendingImageMeta?.name ?? '添付した画像'} />
            <p className="text-ink-faint mt-3 truncate text-xs" title={pendingImageMeta?.name}>{pendingImageMeta?.name ?? '画像'}{pendingImageMeta ? ` ・ ${formatByteSize(pendingImageMeta.size)}` : ''}</p>
          </Dialog>
        ) : null}
      </>
    ) : null}
  </InboxConversationPane>)
}
