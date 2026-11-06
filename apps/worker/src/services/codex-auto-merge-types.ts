
export type CodexAutoMergeMessage = {
  kind: 'auto_merge';
  slackEventId: string;
  channelId: string;
  threadTs: string;
  requesterUserId: string;
  prNumber: number;
  approvedHeadSha: string;
};
