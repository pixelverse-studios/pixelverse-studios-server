import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../src/lib/domani-db', () => ({ domaniDb: { rpc: mocks.rpc } }))
import { dispatchFeedbackReply, sendSupportReply, supportReplyHtml } from '../src/services/domani-feedback-dispatch'
const job = { send_before: '2099-01-01T00:00:00Z', message_id: 'message', lease_token: 'lease', idempotency_key: 'domani-feedback/message', payload: { from: 'Domani <hello@domani-app.com>', to: 'fixture@example.test', subject: 'Hello', text: 'Text' } }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('DOMANI_FEEDBACK_SENDING_ENABLED', 'true'); vi.stubEnv('RESEND_API_KEY', 'synthetic'); })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); })
describe('support Resend adapter', () => {
 it('escapes HTML without adding campaign links or unsubscribe actions', () => {
  const html = supportReplyHtml('<script>x</script> & "quote"');
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).not.toContain('unsubscribe');
 })
 it('sends the exact durable payload and HTTP idempotency key, reports acceptance only', async () => {
  const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'provider-id' })));
  expect(await sendSupportReply(job)).toEqual({ outcome: 'accepted', providerId: 'provider-id' });
  expect(send).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': job.idempotency_key }), body: JSON.stringify(job.payload), signal: expect.any(AbortSignal) }));
 })
 it.each([
  [429, { name: 'rate_limit_exceeded' }, 'retryable'], [409, { name: 'concurrent_idempotent_requests' }, 'retryable'],
  [422, { name: 'validation_error' }, 'permanent'], [403, { name: 'invalid_from_address' }, 'permanent'],
  [409, { name: 'invalid_idempotent_request' }, 'unknown'], [500, {}, 'unknown'],
  [200, { error: { message: 'returned error' } }, 'unknown'], [200, {}, 'unknown'],
 ])('classifies HTTP %s without false success', async (status, body, outcome) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: status as number }));
  expect((await sendSupportReply(job)).outcome).toBe(outcome);
 })
 it('treats thrown timeouts as uncertain', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private recipient info'));
  expect(await sendSupportReply(job)).toEqual({ outcome: 'unknown', errorCode: 'PROVIDER_UNCERTAIN' });
 })
})
describe('durable reply dispatcher', () => {
 it('does not claim or send while disabled', async () => {
  vi.stubEnv('DOMANI_FEEDBACK_SENDING_ENABLED', 'false'); const send = vi.fn();
  expect(await dispatchFeedbackReply(send)).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
 })
 it('finishes under the exact claim token', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: job, error: null }).mockResolvedValueOnce({ data: true, error: null });
  await dispatchFeedbackReply(vi.fn().mockResolvedValue({ outcome: 'accepted', providerId: 'provider' }));
  expect(mocks.rpc).toHaveBeenLastCalledWith('finish_domani_feedback_reply', { p_message_id: 'message', p_lease_token: 'lease', p_outcome: 'accepted', p_provider_id: 'provider', p_error_code: null });
 })
 it('leaves recovery to the lease after accepted-send persistence failure', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: job, error: null }).mockResolvedValueOnce({ data: null, error: { code: 'DATABASE_UNAVAILABLE' } });
  const send = vi.fn().mockResolvedValue({ outcome: 'accepted', providerId: 'provider' });
  await expect(dispatchFeedbackReply(send)).rejects.toMatchObject({ operation: 'finish_domani_feedback_reply', code: 'UNCLASSIFIED_ERROR' });
  expect(send).toHaveBeenCalledTimes(1); expect(mocks.rpc).toHaveBeenCalledTimes(2);
 })
 it('never calls the provider for expired/reconciliation-only work', async () => {
  mocks.rpc.mockResolvedValue({ data: { skipped: true }, error: null }); const send = vi.fn();
  expect(await dispatchFeedbackReply(send)).toBe(true); expect(send).not.toHaveBeenCalled();
 })
})
