import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, MessageCircle, ArrowUpRight } from 'lucide-react'
import { api } from './api'
import { useAuth } from './auth'
export const avatarNames = ['sun', 'wave', 'sprout', 'orbit', 'bloom', 'peak']
export function Avatar({ user, large = false }) {
  return (
    <img
      className={`avatar ${large ? 'large' : ''}`}
      src={`/avatars/${user?.avatar ?? 'sun'}.svg`}
      alt={`${user?.displayName ?? 'Guest'}'s profile picture`}
    />
  )
}
export function ErrorMessage({ children }) {
  return children ? (
    <p className="error" role="alert">
      {children}
    </p>
  ) : null
}
export function usePage(path) {
  const [state, setState] = useState({
    items: [],
    nextCursor: null,
    loading: true,
    error: '',
  })
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const busy = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    const current = ++generation.current
    busy.current = true
    setState({ items: [], nextCursor: null, loading: true, error: '' })
    api(path, { signal: controller.signal })
      .then((data) => {
        if (current === generation.current)
          setState({ ...data, loading: false, error: '' })
      })
      .catch((error) => {
        if (error.name !== 'AbortError' && current === generation.current)
          setState((s) => ({ ...s, loading: false, error: error.message }))
      })
      .finally(() => {
        if (current === generation.current) busy.current = false
      })
    return () => {
      controller.abort()
      generation.current = current + 1
    }
  }, [path, revision])
  async function more() {
    if (busy.current || !state.nextCursor) return
    busy.current = true
    const current = generation.current
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const data = await api(
        `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(state.nextCursor)}`,
      )
      if (current === generation.current)
        setState((s) => ({
          ...data,
          items: [
            ...s.items,
            ...data.items.filter(
              (item) =>
                !s.items.some(
                  (old) =>
                    (old.id ?? old.requesterId) ===
                    (item.id ?? item.requesterId),
                ),
            ),
          ],
          loading: false,
          error: '',
        }))
    } catch (error) {
      if (current === generation.current)
        setState((s) => ({ ...s, loading: false, error: error.message }))
    } finally {
      if (current === generation.current) busy.current = false
    }
  }
  return {
    ...state,
    more,
    refresh: () => setRevision((v) => v + 1),
    setItems: (update) =>
      setState((s) => ({
        ...s,
        items: typeof update === 'function' ? update(s.items) : update,
      })),
  }
}
export function PageEnd({ page, empty = 'Nothing here yet.' }) {
  return (
    <div className="page-end">
      <ErrorMessage>{page.error}</ErrorMessage>
      {page.loading ? (
        <p role="status">Gathering the latest…</p>
      ) : page.error ? (
        <button onClick={page.nextCursor ? page.more : page.refresh}>
          Try again
        </button>
      ) : page.nextCursor ? (
        <button onClick={page.more}>Load more</button>
      ) : (
        <p>{page.items.length ? 'You’re all caught up.' : empty}</p>
      )}
    </div>
  )
}
export function FollowButton({ person, onChange }) {
  const { user, guest } = useAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  if (guest || person.id === user?.id) return null
  async function toggle() {
    setPending(true)
    setError('')
    try {
      const result = await api(`/follows/${person.id}`, {
        method: person.relationship ? 'DELETE' : 'POST',
      })
      onChange({ ...person, relationship: result?.status ?? null })
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="follow-control">
      <button
        className={person.relationship ? 'secondary' : 'primary small'}
        disabled={pending}
        onClick={toggle}
      >
        {pending
          ? 'Updating…'
          : person.relationship === 'ACCEPTED'
            ? 'Unfollow'
            : person.relationship === 'PENDING'
              ? 'Cancel request'
              : 'Request to follow'}
      </button>
      <ErrorMessage>{error}</ErrorMessage>
    </div>
  )
}
export function Person({ person, onChange }) {
  return (
    <div className="person">
      <Link className="person-link" to={`/people/${person.id}`}>
        <Avatar user={person} />
        <span>
          <strong>{person.displayName}</strong>
          <small>@{person.username}</small>
        </span>
      </Link>
      <FollowButton person={person} onChange={onChange} />
    </div>
  )
}
export function Composer({ onCreated }) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      const post = await api('/posts', {
        method: 'POST',
        body: { content: text },
      })
      setText('')
      onCreated(post)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }
  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-top">
        <Avatar user={user} />
        <label htmlFor="post-content">
          A little thought can start something.
        </label>
      </div>
      <textarea
        id="post-content"
        placeholder="What’s on your mind?"
        maxLength={3000}
        required
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
      />
      <div className="composer-bottom">
        <span>{text.length}/3000 · Text, with a human touch.</span>
        <button className="primary" disabled={pending || !text.trim()}>
          {pending ? 'Sharing…' : 'Share a thought'} <ArrowUpRight size={16} />
        </button>
      </div>
      <ErrorMessage>{error}</ErrorMessage>
    </form>
  )
}
export function PostCard({ post: initial, onDelete }) {
  const { user, guest } = useAuth()
  const [post, setPost] = useState(initial)
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [draft, setDraft] = useState(initial.content)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function act(action) {
    setPending(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }
  return (
    <article className="post">
      <header>
        <Link className="person-link" to={`/people/${post.author.id}`}>
          <Avatar user={post.author} />
          <span>
            <strong>{post.author.displayName}</strong>
            <small>@{post.author.username}</small>
          </span>
        </Link>
        <time dateTime={post.createdAt}>
          {new Date(post.createdAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </time>
      </header>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            act(async () => {
              setPost(
                await api(`/posts/${post.id}`, {
                  method: 'PATCH',
                  body: { content: draft },
                }),
              )
              setEditing(false)
            })
          }}
        >
          <label htmlFor={`edit-${post.id}`}>Edit your thought</label>
          <textarea
            id={`edit-${post.id}`}
            required
            maxLength={3000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={pending}
          />
          <div className="actions">
            <button disabled={pending || !draft.trim()} className="primary">
              Save changes
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="post-text">{post.content}</p>
      )}
      <div className="post-actions">
        <button
          aria-label={`${post.liked ? 'Unlike' : 'Like'} post`}
          aria-pressed={post.liked}
          disabled={guest || pending}
          onClick={() =>
            act(async () => {
              const result = await api(`/posts/${post.id}/like`, {
                method: post.liked ? 'DELETE' : 'PUT',
              })
              setPost((p) => ({
                ...p,
                liked: result.liked,
                _count: { ...p._count, likes: result.count },
              }))
            })
          }
        >
          <Heart size={18} fill={post.liked ? 'currentColor' : 'none'} />{' '}
          {post._count.likes}
        </button>
        <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          <MessageCircle size={18} /> {post._count.comments}{' '}
          <span>Comments</span>
        </button>
        {post.authorId === user?.id && (
          <div className="owner-actions">
            <button
              disabled={pending}
              onClick={() => {
                setDraft(post.content)
                setEditing(true)
              }}
            >
              Edit
            </button>
            <button disabled={pending} onClick={() => setDeleting(true)}>
              Delete
            </button>
          </div>
        )}
      </div>
      {deleting && (
        <div
          className="confirm"
          role="group"
          aria-label="Confirm post deletion"
        >
          <p>Delete this post and its comments?</p>
          <button
            disabled={pending}
            className="danger"
            onClick={() =>
              act(async () => {
                await api(`/posts/${post.id}`, { method: 'DELETE' })
                onDelete(post.id)
              })
            }
          >
            Delete permanently
          </button>
          <button disabled={pending} onClick={() => setDeleting(false)}>
            Keep post
          </button>
        </div>
      )}
      <ErrorMessage>{error}</ErrorMessage>
      {expanded && (
        <Comments
          postId={post.id}
          onCountChange={(delta) =>
            setPost((p) => ({
              ...p,
              _count: { ...p._count, comments: p._count.comments + delta },
            }))
          }
        />
      )}
    </article>
  )
}
function Comments({ postId, onCountChange }) {
  const page = usePage(`/posts/${postId}/comments`)
  const { user, guest } = useAuth()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function run(action) {
    setPending(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="comments" aria-label="Comments">
      {page.items.map((c) => (
        <div className="comment" key={c.id}>
          <Avatar user={c.author} />
          <div>
            <Link to={`/people/${c.author.id}`}>
              <strong>{c.author.displayName}</strong>
            </Link>
            <time dateTime={c.createdAt}>
              {new Date(c.createdAt).toLocaleString()}
            </time>
            <p className="post-text">{c.content}</p>
            {user?.id === c.authorId && (
              <button
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    await api(`/comments/${c.id}`, { method: 'DELETE' })
                    page.setItems((items) =>
                      items.filter((item) => item.id !== c.id),
                    )
                    onCountChange(-1)
                  })
                }
              >
                Delete comment
              </button>
            )}
          </div>
        </div>
      ))}
      <PageEnd page={page} empty="Start the conversation." />
      {!guest && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(async () => {
              await api(`/posts/${postId}/comments`, {
                method: 'POST',
                body: { content: text },
              })
              setText('')
              page.refresh()
              onCountChange(1)
            })
          }}
        >
          <label htmlFor={`comment-${postId}`}>Add a comment</label>
          <textarea
            id={`comment-${postId}`}
            maxLength={1000}
            required
            value={text}
            disabled={pending}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="primary small" disabled={pending || !text.trim()}>
            {pending ? 'Sending…' : 'Send comment'}
          </button>
        </form>
      )}
      <ErrorMessage>{error}</ErrorMessage>
    </section>
  )
}
