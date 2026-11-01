import { z } from 'zod'
export const avatars = ['sun', 'wave', 'sprout', 'orbit', 'bloom', 'peak']
const displayName = z.string().trim().min(1).max(50)
const password = z
  .string()
  .min(8)
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= 72,
    'Password must be at most 72 UTF-8 bytes.',
  )
export const signup = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9_]{3,24}$/,
        'Use 3–24 lowercase letters, numbers, or underscores.',
      ),
    displayName,
    password,
    passwordConfirmation: z.string(),
  })
  .strict()
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'Passwords must match.',
    path: ['passwordConfirmation'],
  })
export const profile = z
  .object({
    displayName,
    bio: z.string().trim().max(240),
    avatar: z.enum(avatars),
  })
  .strict()
export const post = z
  .object({ content: z.string().trim().min(1).max(3000) })
  .strict()
export const comment = z
  .object({ content: z.string().trim().min(1).max(1000) })
  .strict()
export const parse = (schema, input) => schema.parse(input)
export const pageSize = 12
export function pagination(query) {
  if (!query.cursor) return {}
  try {
    const value = JSON.parse(Buffer.from(query.cursor, 'base64url').toString())
    if (
      typeof value.id !== 'string' ||
      !value.id ||
      !Number.isFinite(Date.parse(value.createdAt))
    )
      throw new Error()
    const createdAt = new Date(value.createdAt)
    return {
      OR: [
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: value.id } },
      ],
    }
  } catch {
    throw Object.assign(new Error('Invalid pagination cursor.'), {
      status: 400,
    })
  }
}
export function paged(rows) {
  const hasMore = rows.length > pageSize
  const items = rows.slice(0, pageSize)
  const last = items.at(-1)
  return {
    items,
    nextCursor: hasMore
      ? Buffer.from(
          JSON.stringify({ id: last.id, createdAt: last.createdAt }),
        ).toString('base64url')
      : null,
  }
}
export const order = [{ createdAt: 'desc' }, { id: 'desc' }]
