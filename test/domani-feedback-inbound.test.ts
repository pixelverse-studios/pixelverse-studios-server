import { Webhook } from 'svix'
import type { Request, Response as ExpressResponse } from 'express'
import { receiveDelivery } from '../src/controllers/domani-feedback-webhook'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../src/lib/domani-db', () => ({ domaniDb: { rpc: mocks.rpc } }))
import { feedbackReplyDomain, normalizeIncoming, recordIncomingEvent, ingestFeedbackReply } from '../src/services/domani-feedback-inbound'
const id = '10000000-0000-4000-8000-000000000001'
const fixture = () => ({ id, from: 'Test <test@example.test>', to: ['opaque@replies.domani-app.com'], subject: 'Re: Feedback',
    text: 'Thanks\n\n> Earlier text', html: null, headers: {}, message_id: '<test@example.test>', created_at: '2026-09-18T12:00:00Z', attachments: [] })
beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DOMANI_FEEDBACK_INBOUND_ENABLED','true')
    vi.stubEnv('DOMANI_FEEDBACK_REPLY_DOMAIN','replies.domani-app.com')
    vi.stubEnv('RESEND_API_KEY','synthetic')
})
describe('inbound content boundary', () => {
    it('normalizes participant addresses and retains quoted plain text', () => {
        expect(normalizeIncoming(fixture(),id)).toMatchObject({from:'test@example.test',text:'Thanks\n\n> Earlier text',quarantine_reason:null})
    })
    it('converts HTML to inert text without active content, tracking images or URLs', () => {
        const data = normalizeIncoming({...fixture(),text:null,html:'<p>Hello</p><script>alert(1)</script><img src="https://tracking.test/pixel"><a href="javascript:alert(2)">link</a>'},id)
        expect(data.text).toContain('Hello')
        expect(data.text).not.toMatch(/alert|tracking|javascript|<img/)
    })
    it.each([{'auto-submitted':'auto-replied'},{precedence:'bulk'},{'return-path':'<>'},{'content-type':'multipart/report'}])('quarantines automated mail %j',headers=>{
        expect(normalizeIncoming({...fixture(),headers},id).quarantine_reason).toBe('AUTOMATED_MAIL')
    })
    it('omits attachment data and bounds oversized text',()=>{
        const data=normalizeIncoming({...fixture(),text:'a'.repeat(20001),attachments:[{filename:'private.txt',download_url:'https://untrusted.test'}]},id)
        expect(data).toMatchObject({attachment_count:1,quarantine_reason:'MESSAGE_TOO_LARGE'})
        expect(JSON.stringify(data)).not.toContain('private.txt')
        expect(data.text.length).toBe(20000)
    })
    it('rejects malformed participants, IDs and ambiguous headers',()=>{
        expect(normalizeIncoming({...fixture(),from:'forged@example.test\r\nBcc: victim@example.test'},id).quarantine_reason).toBe('INVALID_PARTICIPANT')
        expect(normalizeIncoming({...fixture(),message_id:'bad'},id).quarantine_reason).toBe('INVALID_MESSAGE_ID')
        expect(normalizeIncoming({...fixture(),headers:{'in-reply-to':'<one@test> <two@test>'}},id).quarantine_reason).toBe('AMBIGUOUS_THREAD')
        expect(()=>normalizeIncoming(fixture(),'other')).toThrow('mismatch')
    })
    it('fails closed for root-domain routing and disabled integration',()=>{
        vi.stubEnv('DOMANI_FEEDBACK_REPLY_DOMAIN','domani-app.com');expect(()=>feedbackReplyDomain()).toThrow()
        vi.stubEnv('DOMANI_FEEDBACK_INBOUND_ENABLED','false');expect(feedbackReplyDomain()).toBeUndefined()
    })
})
describe('durable inbound jobs',()=>{
    it('records only the signed provider identifier before retrieval',async()=>{
        mocks.rpc.mockResolvedValue({error:null});await recordIncomingEvent('event',{type:'email.received',data:{email_id:id}})
        expect(mocks.rpc).toHaveBeenCalledWith('receive_domani_feedback_inbound',{p_event_id:'event',p_provider_id:id})
    })
    it('fetches content from the fixed receiving API and finishes under the claim token',async()=>{
        mocks.rpc.mockResolvedValueOnce({data:{provider_id:id,lease_token:'lease'},error:null}).mockResolvedValue({error:null})
        const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(fixture())))
        expect(await ingestFeedbackReply()).toBe(true)
        expect(fetch).toHaveBeenCalledWith(`https://api.resend.com/emails/receiving/${id}`,expect.anything())
        expect(mocks.rpc).toHaveBeenLastCalledWith('finish_domani_feedback_inbound',expect.objectContaining({p_lease_token:'lease',p_error:null,p_payload:expect.objectContaining({text:'Thanks\n\n> Earlier text'})}))
    })
    it('schedules retrieval failure without sending or dropping the receipt',async()=>{
        mocks.rpc.mockResolvedValueOnce({data:{provider_id:id,lease_token:'lease'}}).mockResolvedValue({error:null})
        const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:503}))
        await ingestFeedbackReply()
        expect(mocks.rpc).toHaveBeenLastCalledWith('finish_domani_feedback_inbound',expect.objectContaining({p_error:'PROVIDER_RETRIEVAL_FAILED'}))
        expect(fetch).toHaveBeenCalledTimes(1)
    })
})

it('verifies a signed receiving event and persists it before acknowledgement',async()=>{
    const secret=`whsec_${Buffer.from('synthetic-inbound-webhook-secret').toString('base64')}`
    vi.stubEnv('DOMANI_FEEDBACK_WEBHOOK_SECRET',secret)
    const body=JSON.stringify({type:'email.received',data:{email_id:id}})
    const at=new Date(); const eventId='inbound-event'
    const headers:Record<string,string>={'svix-id':eventId,'svix-timestamp':String(Math.floor(at.getTime()/1000)),'svix-signature':new Webhook(secret).sign(eventId,at,body)}
    const res={status:vi.fn(),json:vi.fn()};res.status.mockReturnValue(res)
    mocks.rpc.mockResolvedValue({error:null})
    await receiveDelivery({body:Buffer.from(body),get:(key:string)=>headers[key]} as Request,res as unknown as ExpressResponse)
    expect(res.status).toHaveBeenCalledWith(202)
    expect(mocks.rpc).toHaveBeenCalledWith('receive_domani_feedback_inbound',{p_event_id:eventId,p_provider_id:id})
    mocks.rpc.mockClear();res.status.mockClear()
    await receiveDelivery({body:Buffer.from(body+' '),get:(key:string)=>headers[key]} as Request,res as unknown as ExpressResponse)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
})
