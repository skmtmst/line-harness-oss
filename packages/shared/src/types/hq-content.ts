export interface HqBannerImageQuery {
  folderId?: string | null;
  projectId?: string; favorite?: boolean; delivered?: boolean; preset?: string;
  shape?: 'square' | 'landscape' | 'portrait' | 'rich_menu';
  q?: string; before?: string; limit?: number; withCounts?: boolean;
}

export interface HqBannerImageCounts { all: number; favorite: number; delivered: number; unused: number }

export interface HqTemplateFolder { id: string; name: string; revision: number; displayOrder?: number; color?: string | null }

export interface HqScenarioDefinition {
  schemaVersion: 1
  scenario: { name: string; description: string | null }
  steps: Array<{ id: string; delayMinutes: number; messageType: 'text' | 'flex'; messageContent: string }>
}

export interface HqTemplateTextOverride { accountId: string; text: string }

export type HqBannerFolderKind = 'project' | 'image';

export interface HqBannerFolder { id: string; kind: HqBannerFolderKind; name: string; color: string | null; displayOrder: number; revision: number; itemCount: number; createdAt: string; updatedAt: string }
