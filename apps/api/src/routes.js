import { Router } from 'express'
import { db, publicUser } from './db.js'
import { member } from './auth.js'
import {
  parse,
  profile,
  post,
  comment,
  pageSize,
  pagination,
  paged,
  order,
} from './validation.js'
const router = Router()
const missing = () =>
  Object.assign(new Error('This item no longer exists or is not yours.'), {
    status: 404,
  })
const postInclude = (userId) => ({
  author: { select: publicUser },
  _count: { select: { likes: true, comments: true } },
  likes: { where: { userId: userId ?? '' }, select: { userId: true } },
})
const postView = (value) => ({
  ...value,
  liked: value.likes.length > 0,
  likes: undefined,
})
async function withRelationship(users, viewerId) {
  const relationships = viewerId
    ? await db.follow.findMany({
        where: {
          requesterId: viewerId,
          recipientId: { in: users.map((u) => u.id) },
        },
      })
    : []
  return users.map((user) => ({
    ...user,
    relationship:
      relationships.find((f) => f.recipientId === user.id)?.status ?? null,
  }))
}
router.get('/users', async (req, res) => {
  const search = String(req.query.q ?? '').slice(0, 50)
  const rows = await db.user.findMany({
    where: {
      AND: [
        pagination(req.query),
        {
          OR: [
            { username: { contains: search, mode: 'insensitive' } },
            { displayName: { contains: search, mode: 'insensitive' } },
          ],
        },
      ],
    },
    select: publicUser,
    orderBy: order,
    take: pageSize + 1,
  })
  const result = paged(rows)
  result.items = await withRelationship(result.items, req.user?.id)
  res.json(result)
})
router.get('/users/:id', async (req, res) => {
  const user = await db.user.findUnique({
    where: { id: req.params.id },
    select: {
      ...publicUser,
      _count: {
        select: {
          incoming: { where: { status: 'ACCEPTED' } },
          outgoing: { where: { status: 'ACCEPTED' } },
        },
      },
    },
  })
  if (!user) throw missing()
  res.json((await withRelationship([user], req.user?.id))[0])
})
router.patch('/profile', member, async (req, res) => {
  res.json(
    await db.user.update({
      where: { id: req.user.id },
      data: parse(profile, req.body),
      select: publicUser,
    }),
  )
})
router.get('/requests', async (req, res) => {
  if (!req.user) return res.json({ items: [], nextCursor: null })
  const rows = await db.follow.findMany({
    where: {
      recipientId: req.user.id,
      status: 'PENDING',
      ...(req.query.cursor
        ? { requesterId: { gt: String(req.query.cursor) } }
        : {}),
    },
    include: { requester: { select: publicUser } },
    orderBy: { requesterId: 'asc' },
    take: pageSize + 1,
  })
  const items = rows.slice(0, pageSize)
  res.json({
    items,
    nextCursor: rows.length > pageSize ? items.at(-1).requesterId : null,
  })
})
router.post('/follows/:id', member, async (req, res) => {
  if (req.params.id === req.user.id)
    return res.status(400).json({ error: 'You cannot follow yourself.' })
  await db.follow.createMany({
    data: [{ requesterId: req.user.id, recipientId: req.params.id }],
    skipDuplicates: true,
  })
  const relationship = await db.follow.findUnique({
    where: {
      requesterId_recipientId: {
        requesterId: req.user.id,
        recipientId: req.params.id,
      },
    },
  })
  res.json(relationship)
})
router.delete('/follows/:id', member, async (req, res) => {
  await db.follow.deleteMany({
    where: { requesterId: req.user.id, recipientId: req.params.id },
  })
  res.status(204).end()
})
router.patch('/requests/:id', member, async (req, res) => {
  if (
    !['accept', 'decline'].includes(req.body.action) ||
    Object.keys(req.body).length !== 1
  )
    return res.status(400).json({ error: 'Choose accept or decline.' })
  const where = {
    requesterId: req.params.id,
    recipientId: req.user.id,
    status: 'PENDING',
  }
  const result =
    req.body.action === 'accept'
      ? await db.follow.updateMany({ where, data: { status: 'ACCEPTED' } })
      : await db.follow.deleteMany({ where })
  if (!result.count)
    return res.status(409).json({
      error:
        'This request is no longer pending. Refresh to see the latest state.',
    })
  res.status(204).end()
})
router.get('/posts', async (req, res) => {
  let scope = {}
  if (req.query.author) scope = { authorId: String(req.query.author) }
  else if (req.user)
    scope = {
      OR: [
        { authorId: req.user.id },
        {
          author: {
            incoming: {
              some: { requesterId: req.user.id, status: 'ACCEPTED' },
            },
          },
        },
      ],
    }
  const rows = await db.post.findMany({
    where: { AND: [scope, pagination(req.query)] },
    orderBy: order,
    take: pageSize + 1,
    include: postInclude(req.user?.id),
  })
  const result = paged(rows)
  result.items = result.items.map(postView)
  res.json(result)
})
router.post('/posts', member, async (req, res) => {
  res.status(201).json(
    postView(
      await db.post.create({
        data: { ...parse(post, req.body), authorId: req.user.id },
        include: postInclude(req.user.id),
      }),
    ),
  )
})
router.patch('/posts/:id', member, async (req, res) => {
  const data = parse(post, req.body)
  const result = await db.post.updateMany({
    where: { id: req.params.id, authorId: req.user.id },
    data,
  })
  if (!result.count) throw missing()
  res.json(
    postView(
      await db.post.findUniqueOrThrow({
        where: { id: req.params.id },
        include: postInclude(req.user.id),
      }),
    ),
  )
})
router.delete('/posts/:id', member, async (req, res) => {
  const result = await db.post.deleteMany({
    where: { id: req.params.id, authorId: req.user.id },
  })
  if (!result.count) throw missing()
  res.status(204).end()
})
router.put('/posts/:id/like', member, async (req, res) => {
  await db.like.createMany({
    data: [{ userId: req.user.id, postId: req.params.id }],
    skipDuplicates: true,
  })
  res.json({
    liked: true,
    count: await db.like.count({ where: { postId: req.params.id } }),
  })
})
router.delete('/posts/:id/like', member, async (req, res) => {
  await db.like.deleteMany({
    where: { userId: req.user.id, postId: req.params.id },
  })
  res.json({
    liked: false,
    count: await db.like.count({ where: { postId: req.params.id } }),
  })
})
router.get('/posts/:id/comments', async (req, res) => {
  if (
    !(await db.post.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    }))
  )
    throw missing()
  res.json(
    paged(
      await db.comment.findMany({
        where: { AND: [{ postId: req.params.id }, pagination(req.query)] },
        orderBy: order,
        take: pageSize + 1,
        include: { author: { select: publicUser } },
      }),
    ),
  )
})
router.post('/posts/:id/comments', member, async (req, res) => {
  res.status(201).json(
    await db.comment.create({
      data: {
        ...parse(comment, req.body),
        postId: req.params.id,
        authorId: req.user.id,
      },
      include: { author: { select: publicUser } },
    }),
  )
})
router.delete('/comments/:id', member, async (req, res) => {
  const result = await db.comment.deleteMany({
    where: { id: req.params.id, authorId: req.user.id },
  })
  if (!result.count) throw missing()
  res.status(204).end()
})
export default router
