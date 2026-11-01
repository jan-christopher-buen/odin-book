import { useEffect, useRef, useState } from 'react'
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom'
import {
  Armchair,
  House,
  Users,
  Inbox,
  LogOut,
  ArrowUpRight,
  RefreshCw,
} from 'lucide-react'
import { api } from './api'
import { useAuth } from './auth'
import {
  Avatar,
  avatarNames,
  Composer,
  ErrorMessage,
  FollowButton,
  PageEnd,
  Person,
  PostCard,
  usePage,
} from './components'
function Brand() {
  return (
    <Link className="brand" to="/">
      <span className="brand-mark">
        <Armchair size={25} strokeWidth={2.5} />
      </span>
      commonroom<span className="brand-dot">✳</span>
    </Link>
  )
}
function Entry() {
  const auth = useAuth()
  const [signup, setSignup] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    setPending(true)
    setError('')
    const body = Object.fromEntries(new FormData(event.currentTarget))
    try {
      await auth.authenticate(signup ? '/signup' : '/login', body)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="entry">
      <header>
        <Brand />
        <span>A place to be yourself.</span>
      </header>
      <main className="entry-grid">
        <section className="entry-story">
          <p className="eyebrow">GOOD COMPANY. EVERY DAY.</p>
          <h1>
            Small thoughts.
            <br />
            Real connections.
          </h1>
          <p>
            A familiar corner of the internet. Share what’s happening, find your
            people, and make a little room for each other.
          </p>
          <div className="entry-art" aria-hidden="true">
            <img src="/avatars/sun.svg" alt="" />
            <img src="/avatars/wave.svg" alt="" />
            <img src="/avatars/bloom.svg" alt="" />
            <span>There’s a seat for you.</span>
          </div>
          <p className="entry-note">Less noise. More “oh, you too?”</p>
        </section>
        <section className="entry-form">
          <p className="eyebrow">COME ON IN</p>
          <h2>{signup ? 'Make yourself at home.' : 'Good to see you.'}</h2>
          <p>
            {signup
              ? 'Your next conversation starts here.'
              : 'Pull up a chair. Catch up with your people.'}
          </p>
          <ErrorMessage>{auth.error}</ErrorMessage>
          <form onSubmit={submit} key={signup ? 'signup' : 'login'}>
            {signup && (
              <label>
                Display name
                <input
                  name="displayName"
                  autoComplete="name"
                  maxLength={50}
                  required
                />
              </label>
            )}
            <label>
              Username
              <input
                name="username"
                autoComplete="username"
                minLength={3}
                maxLength={24}
                pattern="[A-Za-z0-9_]+"
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete={signup ? 'new-password' : 'current-password'}
                minLength={signup ? 8 : undefined}
                required
              />
            </label>
            {signup && (
              <>
                <small>8+ characters, at most 72 UTF-8 bytes.</small>
                <label>
                  Confirm password
                  <input
                    type="password"
                    name="passwordConfirmation"
                    autoComplete="new-password"
                    required
                  />
                </label>
              </>
            )}
            <ErrorMessage>{error}</ErrorMessage>
            <button className="primary wide" disabled={pending}>
              {pending ? 'One moment…' : signup ? 'Create account' : 'Sign in'}{' '}
              <ArrowUpRight size={17} />
            </button>
          </form>
          <div className="or">
            <span />
            OR
            <span />
          </div>
          <button
            className="guest-button wide"
            disabled={pending}
            onClick={async () => {
              setPending(true)
              setError('')
              try {
                await auth.authenticate('/guest')
              } catch (err) {
                setError(err.message)
              } finally {
                setPending(false)
              }
            }}
          >
            Explore as guest <ArrowUpRight size={17} />
          </button>
          <small className="guest-note">
            Take a look around. No account needed. Read-only access.
          </small>
          <p className="switch-auth">
            {signup ? 'Already have a seat?' : 'New around here?'}{' '}
            <button
              disabled={pending}
              onClick={() => {
                setSignup(!signup)
                setError('')
              }}
            >
              {signup ? 'Sign in' : 'Join Commonroom'}
            </button>
          </p>
        </section>
      </main>
      <footer>
        Made for the everyday things worth sharing.
        <span>THE ODIN PROJECT · ODIN-BOOK</span>
      </footer>
    </div>
  )
}
function Shell() {
  const { user, guest, logout } = useAuth()
  const location = useLocation()
  const heading = useRef(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => {
    heading.current?.focus()
  }, [location.pathname])
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Brand />
        <span className="topbar-note">
          A little space for everyday connections.
        </span>
        <div className="topbar-user">
          {guest ? (
            <span className="guest-pill">GUEST PASS</span>
          ) : (
            <>
              <Avatar user={user} />
              <span>{user.displayName}</span>
            </>
          )}
        </div>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <p className="eyebrow">YOUR CORNER</p>
          <nav aria-label="Main navigation">
            <NavLink to="/" end>
              <House size={20} /> The common room
            </NavLink>
            <NavLink to="/people">
              <Users size={20} /> Find your people
            </NavLink>
            {!guest && (
              <>
                <NavLink to="/requests">
                  <Inbox size={20} /> Follow requests
                </NavLink>
                <NavLink to={`/people/${user.id}`}>
                  <Avatar user={user} /> My profile
                </NavLink>
              </>
            )}
          </nav>
          <div className="sidebar-note">
            <span className="sun-symbol">✳</span>
            <h3>
              Good things grow
              <br />
              in good company.
            </h3>
            <p>
              Say something small.
              <br />
              It might mean a lot.
            </p>
          </div>
          <button
            className="logout"
            disabled={pending}
            onClick={async () => {
              setPending(true)
              try {
                await logout()
              } catch (err) {
                setError(err.message)
                setPending(false)
              }
            }}
          >
            <LogOut size={17} />
            {pending ? 'Leaving…' : 'Sign out'}
          </button>
          <ErrorMessage>{error}</ErrorMessage>
          <small className="sidebar-footer">
            COMMONROOM © {new Date().getFullYear()}
          </small>
        </aside>
        <main id="main" ref={heading} tabIndex={-1} className="main-content">
          {guest && (
            <div className="guest-banner">
              <strong>You’re looking around as a guest.</strong>
              <span>Read, explore, and meet the community.</span>
              <button
                disabled={pending}
                onClick={async () => {
                  setPending(true)
                  try {
                    await logout()
                  } catch (err) {
                    setError(err.message)
                    setPending(false)
                  }
                }}
              >
                Sign out to join <ArrowUpRight size={15} />
              </button>
            </div>
          )}
          <Routes>
            <Route path="/" element={<Feed />} />
            <Route path="/people" element={<Directory />} />
            <Route
              path="/people/:id"
              element={<Profile key={location.pathname} />}
            />
            <Route
              path="/requests"
              element={guest ? <Navigate to="/" replace /> : <Requests />}
            />
            <Route
              path="*"
              element={
                <div className="empty">
                  <h1>This corner doesn’t exist.</h1>
                  <Link to="/">Back to the common room</Link>
                </div>
              }
            />
          </Routes>
        </main>
        <aside className="rightbar">
          <p className="eyebrow">A ROOM FOR EVERYONE</p>
          <div className="welcome-art">
            <img src="/avatars/sprout.svg" alt="" />
            <span>
              Stay curious.
              <br />
              Stay connected.
            </span>
          </div>
          <h3>
            The best part?
            <br />
            The people.
          </h3>
          <p>
            Discover a new perspective, follow a familiar face, or find someone
            who gets it.
          </p>
          <Link className="text-link" to="/people">
            Meet the community <ArrowUpRight size={17} />
          </Link>
          <div className="room-rules">
            <p className="eyebrow">MAKE YOURSELF AT HOME</p>
            <p>
              01 <span>Be kind. There’s a person here.</span>
            </p>
            <p>
              02 <span>Share the everyday, too.</span>
            </p>
            <p>
              03 <span>Leave room for other stories.</span>
            </p>
          </div>
          <small>
            A learning project, built with care.
            <br />
            No algorithms. Just your people.
          </small>
        </aside>
      </div>
    </>
  )
}
function PostList({ page }) {
  return (
    <>
      {page.items.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onDelete={(id) =>
            page.setItems((items) => items.filter((p) => p.id !== id))
          }
        />
      ))}
      <PageEnd
        page={page}
        empty="A quiet room, for now. Share a thought or find people to follow."
      />
    </>
  )
}
function Feed() {
  const { guest } = useAuth()
  const page = usePage('/posts')
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PULL UP A CHAIR</p>
          <h1>
            {guest ? 'Around the room' : 'The common room'}
            <span className="heading-spark">✳</span>
          </h1>
          <p>
            {guest
              ? 'Recent thoughts from across the community.'
              : 'Your thoughts, and the people you’ve chosen to follow.'}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh feed"
          disabled={page.loading}
          onClick={page.refresh}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {!guest && (
        <Composer
          onCreated={(post) => page.setItems((items) => [post, ...items])}
        />
      )}
      <div className="section-label">
        <span>{guest ? 'COMMUNITY NOTES' : 'LATEST FROM YOUR PEOPLE'}</span>
        <span>NEWEST FIRST ↓</span>
      </div>
      <PostList page={page} />
    </>
  )
}
function Directory() {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const page = usePage(`/users?q=${encodeURIComponent(search)}`)
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">FAMILIAR FACES, NEW CONNECTIONS</p>
          <h1>Find your people</h1>
          <p>A good conversation begins with a hello.</p>
        </div>
      </div>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault()
          setSearch(query)
        }}
      >
        <label htmlFor="search">Search the community</label>
        <div>
          <input
            id="search"
            type="search"
            maxLength={50}
            placeholder="Name or username"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="primary">Search</button>
        </div>
      </form>
      <div className="people-list">
        {page.items.map((person) => (
          <Person
            key={person.id}
            person={person}
            onChange={(next) =>
              page.setItems((items) =>
                items.map((item) => (item.id === next.id ? next : item)),
              )
            }
          />
        ))}
      </div>
      <PageEnd page={page} empty="No one found. Try a different name." />
    </>
  )
}
function Requests() {
  const page = usePage('/requests')
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  async function respond(id, action) {
    setPending(id)
    setError('')
    try {
      await api(`/requests/${id}`, { method: 'PATCH', body: { action } })
      page.setItems((items) => items.filter((r) => r.requesterId !== id))
    } catch (err) {
      setError(err.message)
    } finally {
      setPending('')
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">LET SOMEONE INTO YOUR CIRCLE</p>
          <h1>Follow requests</h1>
          <p>
            Accepting lets them see your posts in their feed. Following back is
            up to you.
          </p>
        </div>
      </div>
      <ErrorMessage>{error}</ErrorMessage>
      {page.items.map((request) => (
        <div className="request" key={request.requesterId}>
          <Link className="person-link" to={`/people/${request.requesterId}`}>
            <Avatar user={request.requester} />
            <span>
              <strong>{request.requester.displayName}</strong>
              <small>@{request.requester.username}</small>
            </span>
          </Link>
          <div className="actions">
            <button
              disabled={!!pending}
              className="primary small"
              onClick={() => respond(request.requesterId, 'accept')}
            >
              Accept
            </button>
            <button
              disabled={!!pending}
              onClick={() => respond(request.requesterId, 'decline')}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
      <PageEnd
        page={page}
        empty="No pending requests. Your corner is all caught up."
      />
    </>
  )
}
function Profile() {
  const { id } = useParams()
  const { user, updateUser } = useAuth()
  const [person, setPerson] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState(false)
  const page = usePage(`/posts?author=${encodeURIComponent(id)}`)
  useEffect(() => {
    const controller = new AbortController()
    api(`/users/${id}`, { signal: controller.signal })
      .then(setPerson)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message)
      })
    return () => controller.abort()
  }, [id, revision])
  if (!person)
    return (
      <div className="empty">
        <ErrorMessage>{error}</ErrorMessage>
        {error ? (
          <button
            onClick={() => {
              setError('')
              setRevision((v) => v + 1)
            }}
          >
            Try again
          </button>
        ) : (
          <p role="status">Opening this corner…</p>
        )}
      </div>
    )
  return (
    <>
      <div className="profile-cover">
        <span>EVERY PERSON HAS A STORY.</span>
        <span aria-hidden="true">✳</span>
      </div>
      <section className="profile-header">
        <div className="profile-top">
          <Avatar user={person} large />
          {person.id === user?.id ? (
            <button onClick={() => setEditing(!editing)}>
              {editing ? 'Close editor' : 'Edit profile'}
            </button>
          ) : (
            <FollowButton
              person={person}
              onChange={(next) => {
                setPerson(next)
                setRevision((v) => v + 1)
              }}
            />
          )}
        </div>
        <h1>{person.displayName}</h1>
        <p className="handle">@{person.username}</p>
        <p className="bio">
          {person.bio || 'Making a little room for new connections.'}
        </p>
        <p className="profile-counts">
          <strong>{person._count.incoming}</strong> followers <span>·</span>{' '}
          <strong>{person._count.outgoing}</strong> following
        </p>
      </section>
      {editing && (
        <ProfileEditor
          person={person}
          onSave={(next) => {
            setPerson((p) => ({ ...p, ...next }))
            updateUser(next)
            setEditing(false)
          }}
        />
      )}
      <div className="section-label">
        <span>THOUGHTS FROM {person.displayName.toUpperCase()}</span>
        <span>NEWEST FIRST ↓</span>
      </div>
      <PostList page={page} />
    </>
  )
}
function ProfileEditor({ person, onSave }) {
  const [avatar, setAvatar] = useState(person.avatar)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  return (
    <form
      className="profile-editor"
      onSubmit={async (e) => {
        e.preventDefault()
        const body = {
          ...Object.fromEntries(new FormData(e.currentTarget)),
          avatar,
        }
        setPending(true)
        setError('')
        try {
          onSave(await api('/profile', { method: 'PATCH', body }))
        } catch (err) {
          setError(err.message)
        } finally {
          setPending(false)
        }
      }}
    >
      <h2>Your little corner</h2>
      <label>
        Display name
        <input
          name="displayName"
          defaultValue={person.displayName}
          required
          maxLength={50}
        />
      </label>
      <label>
        Bio
        <textarea name="bio" defaultValue={person.bio} maxLength={240} />
      </label>
      <fieldset disabled={pending}>
        <legend>Choose a profile picture</legend>
        <div className="avatar-picker">
          {avatarNames.map((name) => (
            <label key={name}>
              <input
                type="radio"
                name="avatar"
                value={name}
                checked={avatar === name}
                onChange={() => setAvatar(name)}
              />
              <img src={`/avatars/${name}.svg`} alt={name} />
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorMessage>{error}</ErrorMessage>
      <button className="primary" disabled={pending}>
        {pending ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  )
}
export default function App() {
  const auth = useAuth()
  if (auth.loading)
    return (
      <div className="loading">
        <Brand />
        <p role="status">Getting your seat ready…</p>
      </div>
    )
  if (!auth.user && !auth.guest && auth.error && !auth.csrfToken)
    return (
      <div className="loading">
        <Brand />
        <ErrorMessage>{auth.error}</ErrorMessage>
        <button onClick={auth.bootstrap}>Try again</button>
      </div>
    )
  return auth.user || auth.guest ? (
    <Shell key={auth.user?.id ?? 'guest'} />
  ) : (
    <Entry />
  )
}
