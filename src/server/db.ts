import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client'

let prisma: PrismaClient | undefined
export function getDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('Account storage is not configured.')
  return prisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
}
