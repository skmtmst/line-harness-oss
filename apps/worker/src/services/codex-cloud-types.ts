import type { CodexAutoMergeMessage } from './codex-auto-merge-types.js';
export type CodexMentionQueueMessage = (
  | CodexAutoMergeMessage
  | {
      kind: 'inspect_official';
      slackEventId: string;
      teamId: string;
      channelId: string;
      messageTs: string;
      threadTs: string;
      requesterUserId: string;
      prompt: string;
    }
  | {
      kind: 'inspect_relay';
      slackEventId: string;
      channelId: string;
      threadTs: string;
    }
  | {
      kind: 'notify_duplicate';
      slackEventId: string;
      channelId: string;
      threadTs: string;
      officialTaskUrl?: string;
    }
) & { requestId?: string };
