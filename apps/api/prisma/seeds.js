import { faker } from '@faker-js/faker'
import bcrypt from 'bcrypt'
import crypto from 'node:crypto'
import { db } from '../src/db.js'
if (process.env.NODE_ENV === 'production')
  throw new Error('Demo seeding is disabled in production.')
const url = new URL(process.env.DATABASE_URL)
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  !['/odin_book', '/odin_book_test'].includes(url.pathname) ||
  (url.searchParams.get('host') &&
    url.searchParams.get('host') !== '/var/run/postgresql')
)
  throw new Error('Seed only a dedicated local Odin-Book database.')
faker.seed(241)
const names = [
  'Maya Solis',
  'Theo Park',
  'June Rivera',
  'Felix Chen',
  'Amara Okafor',
  'Luca Reyes',
  'Nora Bell',
  'Ishan Mehta',
  'Cleo Santos',
  'Noah Kim',
  'Alma Cruz',
  'Robin Ellis',
  'Ada Fields',
  'Sam Flores',
  'Bea Stone',
]
const avatars = ['sun', 'wave', 'sprout', 'orbit', 'bloom', 'peak']
const thoughts = [
  'Made time for a long walk without headphones today. Turns out the neighborhood has a pretty good soundtrack of its own.',
  'Small win: the basil on my windowsill is still alive. We’re taking this one leaf at a time. 🌱',
  'What’s a book you wish you could read for the first time again? Looking for something to get lost in this weekend.',
  'A reminder I needed today: you don’t have to be good at something to enjoy doing it. My very wobbly pottery agrees.',
  'Rain on the windows. Coffee on the table. Absolutely no plans.\n\nA very good kind of Saturday.',
  'Finally fixed that one bug. The solution was two lines; the journey was three cups of tea.',
  'Tried taking the longer route home and found a tiny secondhand bookshop. Consider this your sign to take a detour.',
  'Learning to make bread has mostly taught me patience. And how to get flour on absolutely everything.',
  'Someone at the market remembered my name today. Funny how the smallest things can make a place feel like home.',
  'Currently collecting little things to look forward to. Today’s entry: cooking dinner with an old friend.',
]
try {
  const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12)
  for (const [i, displayName] of names.entries()) {
    await db.user.upsert({
      where: { username: `demo_${displayName.split(' ')[0].toLowerCase()}` },
      update: {},
      create: {
        id: `demo-user-${i}`,
        username: `demo_${displayName.split(' ')[0].toLowerCase()}`,
        displayName,
        passwordHash: hash,
        avatar: avatars[i % avatars.length],
        bio: `${faker.person.jobTitle()}. ${faker.word.adjective()} days, small discoveries. Fictional demo profile.`,
      },
    })
  }
  // Deterministic IDs keep repeated runs additive; existing profiles and edits are preserved.
  const users = await db.user.findMany({
    where: {
      username: {
        in: names.map((n) => `demo_${n.split(' ')[0].toLowerCase()}`),
      },
    },
    orderBy: { username: 'asc' },
  })
  for (let i = 0; i < 36; i++) {
    const author = users[i % users.length]
    await db.post.upsert({
      where: { id: `demo-post-${i}` },
      update: {},
      create: {
        id: `demo-post-${i}`,
        authorId: author.id,
        content: thoughts[i % thoughts.length],
        createdAt: new Date(Date.now() - i * 3600000),
      },
    })
    await db.comment.upsert({
      where: { id: `demo-comment-${i}` },
      update: {},
      create: {
        id: `demo-comment-${i}`,
        postId: `demo-post-${i}`,
        authorId: users[(i + 1) % users.length].id,
        content: faker.helpers.arrayElement([
          'This made my day. Thanks for sharing!',
          'A little reminder to slow down. Needed this.',
          'I love this. Here’s to more days like that.',
        ]),
      },
    })
    await db.like.upsert({
      where: {
        userId_postId: {
          userId: users[(i + 2) % users.length].id,
          postId: `demo-post-${i}`,
        },
      },
      update: {},
      create: {
        userId: users[(i + 2) % users.length].id,
        postId: `demo-post-${i}`,
      },
    })
  }
  for (let i = 0; i < 8; i++)
    await db.follow.upsert({
      where: {
        requesterId_recipientId: {
          requesterId: users[i].id,
          recipientId: users[i + 1].id,
        },
      },
      update: {},
      create: {
        requesterId: users[i].id,
        recipientId: users[i + 1].id,
        status: i % 3 ? 'ACCEPTED' : 'PENDING',
      },
    })
  console.log(
    'Fictional community seeded. No shared login credentials were created.',
  )
} finally {
  await db.$disconnect()
}
