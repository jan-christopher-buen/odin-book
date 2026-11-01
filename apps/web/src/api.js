let token = ''
let expired = () => {}
export const setExpired = (callback) => {
  expired = callback
}
export async function api(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
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
}
