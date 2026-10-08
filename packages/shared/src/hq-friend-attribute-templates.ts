import type { FriendFieldType } from './types.js';
import type { HqTemplateListDisplay } from './hq-template-list.js';
export type HqFriendAttributeType = 'friend_field' | 'mark';
export type HqFriendAttributeMode = 'create' | 'overwrite' | 'alias' | 'skip';
export interface HqFriendAttributeFolder {
  id: string; name: string; parentId?: string | null; color?: string | null;
}
export interface HqFriendFieldOption {
  id: string; label: string; color?: string | null; status?: 'active' | 'archived'; displayOrder?: number;
}
export interface HqFriendFieldDefinition {
  schemaVersion: 1;
  field: {
    name: string; fieldKey: string; type: FriendFieldType;
    options?: (string | HqFriendFieldOption)[] | null; defaultValue?: string | null;
    source?: 'manual' | 'form' | 'ec' | 'automation';
    ecFieldPath?: string | null; ecIsMaster?: boolean; isPersonal?: boolean; isStarred?: boolean;
    displayOrder?: number; folderId?: string | null;
  };
  folders: HqFriendAttributeFolder[];
}
export interface HqMarkDefinition {
  schemaVersion: 1;
  mark: { name: string; color?: string; isDefault?: boolean; autoOnInbound?: boolean; displayOrder?: number };
}
export interface HqFriendAttributeDefinitions { friend_field: HqFriendFieldDefinition; mark: HqMarkDefinition }
export type HqFriendAttributeInput = {
  [K in HqFriendAttributeType]: { type: K; name: string; description?: string; folderId?: string | null; definition: HqFriendAttributeDefinitions[K] }
}[HqFriendAttributeType];
export interface HqFriendAttributeTemplate extends HqTemplateListDisplay {
  id: string; name: string; description: string | null; template_type: HqFriendAttributeType;
  folder_id?: string | null; revision: number; updated_at: string;
}
export type HqFriendAttributeDetail = {
  [K in HqFriendAttributeType]: { template: Omit<HqFriendAttributeTemplate, keyof HqTemplateListDisplay> & { template_type: K }; definition: HqFriendAttributeDefinitions[K] }
}[HqFriendAttributeType];
export interface HqAttributeKindCounts { tag: number; friend_field: number; support_mark: number }
