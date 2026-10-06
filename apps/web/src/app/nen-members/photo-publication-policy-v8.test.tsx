// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const create = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({api:{nenMembers:{createPhotoRewardPolicyVersion:create}}}))
vi.mock('@/lib/staff-capability', () => ({isOwnerOrAdmin:()=>true}))
import { PhotoRewardPolicyDrawer } from './photo-reward-policy'
afterEach(cleanup)
const props={open:true,versions:[],loading:false,error:'',onReload:vi.fn(),onClose:vi.fn(),onChanged:vi.fn()}
it('V8の報酬欄から追加点数を保存する', async () => {
  create.mockResolvedValue({success:true,data:{version:{versionNumber:1}}})
  render(<PhotoRewardPolicyDrawer {...props} showPublicationReward />)
  fireEvent.change(screen.getByLabelText('採用1枚につき付ける点数'),{target:{value:'10'}})
  fireEvent.change(screen.getByLabelText('掲載されたら（さらに）'),{target:{value:'200'}})
  fireEvent.click(screen.getByRole('button',{name:'新しい版を保存する'}))
  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({points:10,publicationPoints:200})))
})
it('V7では掲載報酬の欄を増やさない', () => {
  render(<PhotoRewardPolicyDrawer {...props} />)
  expect(screen.queryByLabelText('掲載されたら（さらに）')).toBeNull()
})
