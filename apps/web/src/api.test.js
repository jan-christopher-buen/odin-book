import { afterEach, expect, test, vi } from 'vitest'
import { api } from './api'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const waitForAbort = (_url, { signal }) =>
  new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      })
  })
test('a stalled bootstrap request aborts and becomes a retryable error', async () => {
  vi.useFakeTimers()
  const fetchMock = vi.fn(waitForAbort)
  vi.stubGlobal('fetch', fetchMock)
  const outcome = expect(api('/session')).rejects.toThrow(
    'The connection timed out. Please try again.',
  )
  await vi.advanceTimersByTimeAsync(105000)
  await outcome
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
test('navigation cancellation keeps AbortError and releases its deadline', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(waitForAbort))
  const navigation = new AbortController()
  const outcome = expect(
    api('/posts', { signal: navigation.signal }),
  ).rejects.toHaveProperty('name', 'AbortError')
  navigation.abort()
  await outcome
  expect(vi.getTimerCount()).toBe(0)
})
test('successful bootstrap carries CSRF into mutations and clears timers', async () => {
  vi.useFakeTimers()
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ csrfToken: 'session-token' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'post' }),
    })
  vi.stubGlobal('fetch', fetchMock)
  await api('/session')
  await expect(
    api('/posts', { method: 'POST', body: { content: 'Hello' } }),
  ).resolves.toEqual({ id: 'post' })
  expect(fetchMock.mock.calls[1][1].headers['X-CSRF-Token']).toBe(
    'session-token',
  )
  expect(vi.getTimerCount()).toBe(0)
})
