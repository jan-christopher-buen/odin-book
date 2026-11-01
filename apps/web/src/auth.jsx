import { createContext, useContext, useEffect, useState } from 'react'
import { api, setExpired } from './api'
const Context = createContext(null)
export const useAuth = () => useContext(Context)
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  async function bootstrap() {
    setLoading(true)
    try {
      setSession(await api('/session'))
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    let active = true
    api('/session')
      .then((value) => {
        if (active) setSession(value)
      })
      .catch((err) => {
        if (active) setError(err.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    setExpired(() => {
      setSession({ user: null, guest: false, csrfToken: 'expired' })
      setError('Your session ended. Please sign in again.')
      api('/session').catch(() => {})
    })
    return () => {
      active = false
      setExpired(() => {})
    }
  }, [])
  async function authenticate(path, body) {
    const value = await api(path, { method: 'POST', body })
    setError('')
    setSession(value)
  }
  async function logout() {
    await api('/logout', { method: 'POST' })
    setSession(null)
    await bootstrap()
  }
  return (
    <Context.Provider
      value={{
        ...session,
        loading,
        error,
        bootstrap,
        authenticate,
        logout,
        updateUser: (user) => setSession((value) => ({ ...value, user })),
      }}
    >
      {children}
    </Context.Provider>
  )
}
