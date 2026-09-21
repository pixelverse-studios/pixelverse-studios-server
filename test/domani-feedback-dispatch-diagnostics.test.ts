import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../src/lib/domani-db', () => ({ domaniDb: { rpc: mocks.rpc } }))
import { DispatchFailure, createDispatchDiagnostics } from '../src/services/domani-feedback-dispatch-diagnostics'
import { dispatchFeedbackReply, startFeedbackReplyDispatcher } from '../src/services/domani-feedback-dispatch'
let timer: NodeJS.Timeout | null = null
beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    vi.stubEnv('DOMANI_FEEDBACK_SENDING_ENABLED', 'true'); vi.stubEnv('RESEND_API_KEY', 'fixture')
    mocks.rpc.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => { if (timer) clearInterval(timer); timer = null; vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
describe('dispatch diagnostics', () => {
    it('reports returned RPC errors with operation and HTTP status without private fields', async () => {
        mocks.rpc.mockResolvedValue({ data: null, status: 404, error: {code:'PGRST202',message:'private@example.test',details:'Bearer secret',hint:'private SQL'} })
        const send = vi.fn()
        await expect(dispatchFeedbackReply(send)).rejects.toMatchObject({operation:'claim_domani_feedback_reply',code:'PGRST202',httpStatus:404})
        expect(send).not.toHaveBeenCalled()
        const diagnostics = createDispatchDiagnostics()
        try { await dispatchFeedbackReply(send) } catch (error) { diagnostics.failure(error) }
        const logs = JSON.stringify(vi.mocked(console.error).mock.calls)
        expect(logs).toContain('PGRST202'); expect(logs).not.toMatch(/private|Bearer|secret/)
    })
    it('identifies transport rejection at the claim stage', async () => {
        mocks.rpc.mockRejectedValue(Object.assign(new Error('private URL'), {cause:{code:'ECONNRESET'}}))
        await expect(dispatchFeedbackReply()).rejects.toMatchObject({operation:'claim_domani_feedback_reply',code:'ECONNRESET'})
    })
    it('throttles identical failures while polling continues, then reports recovery once', async () => {
        mocks.rpc.mockResolvedValue({data:null,error:{code:'PGRST202'},status:404})
        timer = startFeedbackReplyDispatcher()
        await vi.advanceTimersByTimeAsync(50_000)
        expect(mocks.rpc).toHaveBeenCalledTimes(6)
        expect(console.error).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(10_000)
        expect(console.error).toHaveBeenCalledTimes(2)
        expect(console.error).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({consecutiveFailures:7,suppressedRepeats:5}))
        mocks.rpc.mockResolvedValue({data:null,error:null,status:200})
        await vi.advanceTimersByTimeAsync(20_000)
        expect(console.info).toHaveBeenCalledTimes(1)
        mocks.rpc.mockResolvedValue({data:null,error:{code:'PGRST202'},status:404})
        await vi.advanceTimersByTimeAsync(10_000)
        expect(console.error).toHaveBeenCalledTimes(3)
    })
    it('reports a different failure immediately and drops unsafe codes', () => {
        const diagnostics = createDispatchDiagnostics()
        diagnostics.failure(new DispatchFailure('claim_domani_feedback_reply',{code:'42501'},403))
        diagnostics.failure(new DispatchFailure('finish_domani_feedback_reply',{code:'42501'},403))
        diagnostics.failure(new DispatchFailure('finish_domani_feedback_reply',{code:'private@example.test',message:'secret'},500))
        expect(console.error).toHaveBeenCalledTimes(3)
        expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/private|secret/)
        expect(console.error).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({code:'UNCLASSIFIED_ERROR',httpStatus:500}))
    })
    it('keeps an idle healthy dispatcher quiet', async () => {
        mocks.rpc.mockResolvedValue({data:null,error:null,status:200})
        timer=startFeedbackReplyDispatcher()
        await vi.advanceTimersByTimeAsync(30_000)
        expect(console.error).not.toHaveBeenCalled();expect(console.info).not.toHaveBeenCalled()
    })
})
