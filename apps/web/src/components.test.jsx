import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { Composer, FollowButton, PostCard, usePage } from './components'
import { AuthProvider, useAuth } from './auth'
import App from './App'
import { api } from './api'
vi.mock('./api', () => ({ api: vi.fn(), setExpired: vi.fn() }))
vi.mock('./auth', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, useAuth: vi.fn() }
})
const user = { id: 'a', username: 'alice', displayName: 'Alice', avatar: 'sun' }
const post = {
  id: 'p',
  authorId: 'a',
  author: user,
  content: '<script>alert("unsafe")</script>\nA second line',
  createdAt: '2026-01-01T00:00:00Z',
  liked: false,
  _count: { likes: 2, comments: 0 },
}
const wrap = (component) => render(<MemoryRouter>{component}</MemoryRouter>)
beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ user, guest: false })
})
test('failed post preserves draft, restores submit, then clears on success', async () => {
  const onCreated = vi.fn()
  api
    .mockRejectedValueOnce(new Error('Offline. Try again.'))
    .mockResolvedValueOnce(post)
  wrap(<Composer onCreated={onCreated} />)
  const input = screen.getByLabelText('A little thought can start something.')
  await userEvent.type(input, 'My draft')
  await userEvent.click(screen.getByRole('button', { name: /Share a thought/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
  expect(input).toHaveValue('My draft')
  expect(screen.getByRole('button', { name: /Share a thought/ })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: /Share a thought/ }))
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(post))
  expect(input).toHaveValue('')
})
test('follow control changes to pending, recovers from failed cancel', async () => {
  const person = { ...user, id: 'b', relationship: null }
  const changed = vi.fn()
  api.mockResolvedValueOnce({ status: 'PENDING' })
  const { rerender } = wrap(<FollowButton person={person} onChange={changed} />)
  await userEvent.click(
    screen.getByRole('button', { name: 'Request to follow' }),
  )
  expect(changed).toHaveBeenCalledWith({ ...person, relationship: 'PENDING' })
  rerender(
    <MemoryRouter>
      <FollowButton
        person={{ ...person, relationship: 'PENDING' }}
        onChange={changed}
      />
    </MemoryRouter>,
  )
  api.mockRejectedValueOnce(new Error('Connection lost'))
  await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost')
  expect(screen.getByRole('button', { name: 'Cancel request' })).toBeEnabled()
})
test('posts render untrusted text literally and update accurate like state', async () => {
  api.mockResolvedValueOnce({ liked: true, count: 3 })
  const { container } = wrap(<PostCard post={post} onDelete={vi.fn()} />)
  expect(screen.getByText(/<script>/)).toBeVisible()
  expect(container.querySelector('script')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Like post' }))
  expect(
    await screen.findByRole('button', { name: 'Unlike post' }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Unlike post' })).toHaveTextContent(
    '3',
  )
})
test('guest cannot like and does not get follow mutations', () => {
  useAuth.mockReturnValue({ guest: true, user: null })
  wrap(
    <>
      <PostCard post={post} onDelete={vi.fn()} />
      <FollowButton person={{ ...user, id: 'b' }} onChange={vi.fn()} />
    </>,
  )
  expect(screen.getByRole('button', { name: 'Like post' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Request to follow' })).toBeNull()
})
test('stale page responses never replace newer navigation', async () => {
  let resolveOld
  api.mockImplementation((path) =>
    path === '/old'
      ? new Promise((resolve) => {
          resolveOld = resolve
        })
      : Promise.resolve({ items: [{ id: 'new' }], nextCursor: null }),
  )
  function View({ path }) {
    const page = usePage(path)
    return (
      <div>
        {page.items.map((item) => (
          <span key={item.id}>{item.id}</span>
        ))}
      </div>
    )
  }
  const { rerender } = render(<View path="/old" />)
  rerender(<View path="/new" />)
  expect(await screen.findByText('new')).toBeVisible()
  resolveOld({ items: [{ id: 'old' }], nextCursor: null })
  await waitFor(() => expect(screen.queryByText('old')).toBeNull())
})
test('entry submits credentials and offers explicit read-only guest access', async () => {
  const authenticate = vi
    .fn()
    .mockRejectedValueOnce(new Error('Incorrect password'))
    .mockResolvedValueOnce({})
  useAuth.mockReturnValue({ loading: false, authenticate, csrfToken: 'token' })
  wrap(<App />)
  await userEvent.type(screen.getByLabelText('Username'), 'alice')
  await userEvent.type(screen.getByLabelText('Password'), 'wrong-password')
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Incorrect password',
  )
  expect(screen.getByLabelText('Username')).toHaveValue('alice')
  await userEvent.click(
    screen.getByRole('button', { name: /Explore as guest/ }),
  )
  expect(authenticate).toHaveBeenLastCalledWith('/guest')
  expect(screen.getByText(/Read-only access/)).toBeVisible()
})
test('provider restores a session and clears it on logout', async () => {
  // The actual provider is exercised through a context consumer.
  const { useAuth: actualUseAuth } = await vi.importActual('./auth')
  api
    .mockResolvedValueOnce({ user, guest: false })
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ user: null, guest: false })
  function Consumer() {
    const auth = actualUseAuth()
    return (
      <>
        <p>{auth.user?.username ?? 'Signed out'}</p>
        <button onClick={auth.logout}>Leave</button>
      </>
    )
  }
  render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>,
  )
  expect(await screen.findByText('alice')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
  expect(await screen.findByText('Signed out')).toBeVisible()
})
