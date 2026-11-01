import { PrismaClient } from '@prisma/client'
export const db = new PrismaClient()
export const publicUser = {
  id: true,
  username: true,
  displayName: true,
  bio: true,
  avatar: true,
  createdAt: true,
}
