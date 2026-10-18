export interface FriendListCursor { createdAt: string; id: string; sort: 'oldest'|'recent' }
export function readFriendListCursor(raw: string): FriendListCursor {
  if(raw.length>1024||!/^[A-Za-z0-9_-]+$/.test(raw))throw new Error('invalid_list_cursor');
  const value=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)))) as Partial<FriendListCursor>;
  if(!value||typeof value.createdAt!=='string'||value.createdAt.length>64||!Number.isFinite(Date.parse(value.createdAt))
    ||typeof value.id!=='string'||!value.id.length||value.id.length>128||!['oldest','recent'].includes(value.sort ?? ''))throw new Error('invalid_list_cursor');
  return value as FriendListCursor;
}
export function friendListCursor(value: FriendListCursor): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
