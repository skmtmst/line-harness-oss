// Compatibility entry for existing consumers; implementation lives with its feature.
export { getFollowingLineUserIdsByTag, getFriendAddBreakdown, getFriendById, getFriendByLineUserId, getFriendByLineUserIdForAccount, getFriends, getFriendWithFirstTrackedLinkName, getMergedMetadataByUserId, isFriendLineUserIdConflict, setFriendFirstTrackedLinkIfNull, updateFriendFollowStatus, upsertFriend } from './friends/index.js';
export type { Friend, FriendWithFirstTrackedLinkName, GetFriendsOptions, UpsertFriendInput } from './friends/index.js';
