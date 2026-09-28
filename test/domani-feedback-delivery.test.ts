import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { Webhook } from 'svix'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../src/lib/domani-db', () => ({ domaniDb: { rpc: mocks.rpc } }))
import { receiveDelivery } from '../src/controllers/domani-feedback-webhook'
import { recordDeliveryEvent, reconcileDelivery, replayDeliveryEvents } from '../src/services/domani-feedback-delivery'
import { feedbackHistorySchema } from '../src/lib/domani-feedback'
const secret = `whsec_${Buffer.from('synthetic-test-secret-not-a-real-key').toString('base64')}`
const payload = JSON.stringify({ type: 'email.delivered', created_at: '2026-09-18T12:00:00Z', data: { email_id: 'provider-1', tags: { domani_feedback_message: '20000000-0000-4000-8000-000000000001' } } })
function response() { const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res); return res as unknown as Response }
function request(body = payload, at = new Date()) {
 const headers: Record<string,string> = { 'svix-id': 'synthetic-event', 'svix-timestamp': String(Math.floor(at.getTime()/1000)), 'svix-signature': new Webhook(secret).sign('synthetic-event', at, payload) }
 return { body: Buffer.from(body), get: (name: string) => headers[name] } as unknown as Request
}
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: 'applied', error: null }); vi.stubEnv('DOMANI_FEEDBACK_WEBHOOK_SECRET', secret) })
describe('signed delivery boundary', () => {
 it('acknowledges only after durable receipt and passes signed correlation tags', async () => {
  const res=response(); await receiveDelivery(request(),res);
  expect(res.status).toHaveBeenCalledWith(202);
  expect(mocks.rpc).toHaveBeenCalledWith('receive_domani_feedback_delivery', expect.objectContaining({ p_event_id:'synthetic-event', p_provider_id:'provider-1', p_tagged_message_id:'20000000-0000-4000-8000-000000000001' }));
 })
 it('rejects tampered raw payloads',async()=>{ const res=response(); await receiveDelivery(request(payload+' '),res); expect(res.status).toHaveBeenCalledWith(400); expect(mocks.rpc).not.toHaveBeenCalled() })
 it('rejects old signed replay timestamps',async()=>{ const res=response(); await receiveDelivery(request(payload,new Date(Date.now()-600000)),res); expect(res.status).toHaveBeenCalledWith(400); expect(mocks.rpc).not.toHaveBeenCalled() })
 it('fails closed without the webhook secret',async()=>{ vi.stubEnv('DOMANI_FEEDBACK_WEBHOOK_SECRET',''); const res=response(); await receiveDelivery(request(),res); expect(res.status).toHaveBeenCalledWith(503); expect(mocks.rpc).not.toHaveBeenCalled() })
 it('requests provider retry when persistence fails',async()=>{ mocks.rpc.mockResolvedValue({error:{code:'database-failed'}}); const res=response(); await receiveDelivery(request(),res); expect(res.status).toHaveBeenCalledWith(503) })
 it('durably accepts unknown identifiers for later correlation',async()=>{ mocks.rpc.mockResolvedValue({data:'unmatched',error:null}); expect(await recordDeliveryEvent('unknown',JSON.parse(payload))).toBe('unmatched') })
 it('rejects malformed timestamps before persistence',async()=>{ await expect(recordDeliveryEvent('bad',{...JSON.parse(payload),created_at:'invalid'})).rejects.toThrow(); expect(mocks.rpc).not.toHaveBeenCalled() })
 it('replays durable unmatched events without a send',async()=>{ await replayDeliveryEvents(); expect(mocks.rpc).toHaveBeenCalledWith('replay_domani_feedback_delivery') })
})
describe('provider reconciliation',()=>{
 it('retrieves the stored provider ID and records delivery evidence without sending',async()=>{
  vi.stubEnv('RESEND_API_KEY','synthetic');
  mocks.rpc.mockResolvedValueOnce({data:{provider_id:'provider-1',message_id:'message'},error:null}).mockResolvedValueOnce({data:'applied',error:null});
  const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'provider-1',last_event:'delivered'})));
  await reconcileDelivery('beta_feedback','feedback','key');
  expect(fetch).toHaveBeenCalledWith('https://api.resend.com/emails/provider-1',expect.objectContaining({signal:expect.any(AbortSignal)}));
  expect(fetch.mock.calls[0][1]?.method).toBeUndefined();
  expect(mocks.rpc).toHaveBeenLastCalledWith('receive_domani_feedback_delivery',expect.objectContaining({p_event_type:'email.delivered',p_provider_id:'provider-1'}));
 })
 it('does not guess provider IDs for unknown sends or repeat rate-limited checks',async()=>{
  vi.stubEnv('RESEND_API_KEY','synthetic'); mocks.rpc.mockResolvedValue({data:null,error:null}); const fetch=vi.spyOn(globalThis,'fetch');
  await reconcileDelivery('beta_feedback','feedback','key'); expect(fetch).not.toHaveBeenCalled();
 })
 it('does not map an unrelated provider response',async()=>{
  vi.stubEnv('RESEND_API_KEY','synthetic'); mocks.rpc.mockResolvedValue({data:{provider_id:'expected'},error:null});
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'unrelated',last_event:'delivered'})));
  await expect(reconcileDelivery('beta_feedback','feedback','key')).rejects.toThrow('mismatch'); expect(mocks.rpc).toHaveBeenCalledTimes(1);
 })
})
it('accepts latest/before pagination without mixing opposite cursors',()=>{
 expect(feedbackHistorySchema.parse({latest:'true'})).toEqual({latest:'true',limit:50});
 expect(feedbackHistorySchema.safeParse({latest:'true',after:'20000000-0000-4000-8000-000000000001'}).success).toBe(false);
})
