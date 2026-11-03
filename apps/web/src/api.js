let token = ''
let expired = () => {}
export const setExpired = (callback) => {
  expired = callback
}
export async function api(path, { method = 'GET', body, signal } = {}) {
  // Leave room for the production proxy's 90-second free-service wake-up window.
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), 105000)
  try {
    const response = await fetch(`/api${path}`, {
      method,
      signal: signal
        ? AbortSignal.any([signal, deadline.signal])
        : deadline.signal,
      credentials: 'same-origin',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRF-Token': token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = response.status === 204 ? null : await response.json()
    if (!response.ok) {
      if (response.status === 401 && path !== '/login') expired()
      if (data?.code === 'CSRF') {
        const session = await api('/session')
        token = session.csrfToken
      }
      throw new Error(data?.error ?? 'Request failed. Please try again.')
    }
    if (data?.csrfToken) token = data.csrfToken
    return data
  } catch (error) {
    if (deadline.signal.aborted && !signal?.aborted) {
      throw new Error(
        method === 'GET'
          ? 'The connection timed out. Please try again.'
          : 'The connection timed out. Refresh to check whether your changes were saved.',
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
