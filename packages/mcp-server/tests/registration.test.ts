import { describe, it, expect } from 'vitest'
import { registerAllTools } from '../src/tools/index.js'
import { registerSendMessage } from '../src/tools/send-message.js'
import { registerBroadcast } from '../src/tools/broadcast.js'
import { registerCreateScenario } from '../src/tools/create-scenario.js'
import { registerEnrollScenario } from '../src/tools/enroll-scenario.js'
import { registerManageTags } from '../src/tools/manage-tags.js'
import { registerCreateForm } from '../src/tools/create-form.js'
import { registerCreateTrackedLink } from '../src/tools/create-tracked-link.js'
import { registerCreateRichMenu } from '../src/tools/create-rich-menu.js'
import { registerListFriends } from '../src/tools/list-friends.js'
import { registerGetFriendDetail } from '../src/tools/get-friend-detail.js'
import { registerGetFormSubmissions } from '../src/tools/get-form-submissions.js'
import { registerGetLinkClicks } from '../src/tools/get-link-clicks.js'
import { registerAccountSummary } from '../src/tools/account-summary.js'
import { registerListCrmObjects } from '../src/tools/list-crm-objects.js'
import { registerManageAdPlatforms } from '../src/tools/manage-ad-platforms.js'
import { registerGetConversionLogs } from '../src/tools/get-conversion-logs.js'
import { registerManageStaff } from '../src/tools/manage-staff.js'
import { registerUploadImage } from '../src/tools/upload-image.js'
import { registerManageFriends } from '../src/tools/manage-friends.js'
import { registerManageScenarios } from '../src/tools/manage-scenarios.js'
import { registerManageBroadcasts } from '../src/tools/manage-broadcasts.js'
import { registerManageRichMenus } from '../src/tools/manage-rich-menus.js'
import { registerManageForms } from '../src/tools/manage-forms.js'
import { registerManageTrackedLinks } from '../src/tools/manage-tracked-links.js'
import { registerManageAutoReplies } from '../src/tools/manage-auto-replies.js'
import { registerManageTrafficPools } from '../src/tools/manage-traffic-pools.js'
import { registerManageMessageTemplates } from '../src/tools/manage-message-templates.js'
import { registerListConversations } from '../src/tools/list-conversations.js'
import { registerGetConversation } from '../src/tools/get-conversation.js'

// NOTE: auto-track-urls.ts is a helper (no server.tool call) and is
// intentionally not registered. The count below is the contract: adding,
// removing, or renaming a tool must update this list on purpose.

export const EXPECTED_TOOL_NAMES = [
  'account_summary',
  'broadcast',
  'create_form',
  'create_rich_menu',
  'create_scenario',
  'create_tracked_link',
  'enroll_in_scenario',
  'get_conversation',
  'get_conversion_logs',
  'get_form_submissions',
  'get_friend_detail',
  'get_link_clicks',
  'list_conversations',
  'list_crm_objects',
  'list_friends',
  'manage_ad_platforms',
  'manage_auto_replies',
  'manage_broadcasts',
  'manage_forms',
  'manage_friends',
  'manage_message_templates',
  'manage_rich_menus',
  'manage_scenarios',
  'manage_staff',
  'manage_tags',
  'manage_tracked_links',
  'manage_traffic_pools',
  'send_message',
  'upload_image',
] as const

export interface CapturedTool {
  name: string
  description: string
  paramsShape: Record<string, unknown>
  handler: (args: never) => Promise<unknown>
}

export function captureRegistrations(
  register: (server: never) => void,
): CapturedTool[] {
  const captured: CapturedTool[] = []
  const fakeServer = {
    tool: (
      name: string,
      description: string,
      paramsShape: Record<string, unknown>,
      handler: (args: never) => Promise<unknown>,
    ) => {
      captured.push({ name, description, paramsShape, handler })
    },
  }
  register(fakeServer as never)
  return captured
}

function isZodSchema(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === 'function'
  )
}

describe('mcp tool registration (29 tools)', () => {
  it('registers exactly 29 tools with no duplicate names', () => {
    const tools = captureRegistrations(registerAllTools)
    expect(tools).toHaveLength(29)
    const names = tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('registers the exact expected tool names (no missing, no extra)', () => {
    const tools = captureRegistrations(registerAllTools)
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...EXPECTED_TOOL_NAMES].sort(),
    )
  })

  it('every tool has a non-empty description', () => {
    const tools = captureRegistrations(registerAllTools)
    for (const tool of tools) {
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  it('every tool exposes a loadable zod params shape', () => {
    const tools = captureRegistrations(registerAllTools)
    for (const tool of tools) {
      const entries = Object.entries(tool.paramsShape)
      // All current tools take at least one param; an empty shape would
      // mean a registration lost its schema on the way.
      expect(entries.length).toBeGreaterThan(0)
      for (const [key, schema] of entries) {
        expect(
          isZodSchema(schema),
          `${tool.name}.${key} should be a zod schema`,
        ).toBe(true)
      }
      expect(typeof tool.handler).toBe('function')
    }
  })

  it('each register* module contributes exactly its own tool', () => {
    const modules: Array<{ register: (server: never) => void; name: string }> = [
      { register: registerSendMessage, name: 'send_message' },
      { register: registerBroadcast, name: 'broadcast' },
      { register: registerCreateScenario, name: 'create_scenario' },
      { register: registerEnrollScenario, name: 'enroll_in_scenario' },
      { register: registerManageTags, name: 'manage_tags' },
      { register: registerCreateForm, name: 'create_form' },
      { register: registerCreateTrackedLink, name: 'create_tracked_link' },
      { register: registerCreateRichMenu, name: 'create_rich_menu' },
      { register: registerListFriends, name: 'list_friends' },
      { register: registerGetFriendDetail, name: 'get_friend_detail' },
      { register: registerGetFormSubmissions, name: 'get_form_submissions' },
      { register: registerGetLinkClicks, name: 'get_link_clicks' },
      { register: registerAccountSummary, name: 'account_summary' },
      { register: registerListCrmObjects, name: 'list_crm_objects' },
      { register: registerManageAdPlatforms, name: 'manage_ad_platforms' },
      { register: registerGetConversionLogs, name: 'get_conversion_logs' },
      { register: registerManageStaff, name: 'manage_staff' },
      { register: registerUploadImage, name: 'upload_image' },
      { register: registerManageFriends, name: 'manage_friends' },
      { register: registerManageScenarios, name: 'manage_scenarios' },
      { register: registerManageBroadcasts, name: 'manage_broadcasts' },
      { register: registerManageRichMenus, name: 'manage_rich_menus' },
      { register: registerManageForms, name: 'manage_forms' },
      { register: registerManageTrackedLinks, name: 'manage_tracked_links' },
      { register: registerManageAutoReplies, name: 'manage_auto_replies' },
      { register: registerManageTrafficPools, name: 'manage_traffic_pools' },
      { register: registerManageMessageTemplates, name: 'manage_message_templates' },
      { register: registerListConversations, name: 'list_conversations' },
      { register: registerGetConversation, name: 'get_conversation' },
    ]
    expect(modules).toHaveLength(29)
    for (const mod of modules) {
      const tools = captureRegistrations(mod.register)
      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe(mod.name)
    }
  })
})
