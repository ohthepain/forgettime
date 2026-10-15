import { boolean, foreignKey, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

// Preserve the existing PostgreSQL names and millisecond timestamp precision.
const date = (name: string) => timestamp(name, { precision: 3, mode: 'date' })
const createdAt = () => date('createdAt').defaultNow().notNull()
const updatedAt = () => date('updatedAt').notNull().$onUpdate(() => new Date())

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('emailVerified').default(false).notNull(),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('user_email_key').on(table.email)])

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: date('expiresAt').notNull(),
  token: text('token').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull(),
}, (table) => [foreignKey({ name: 'session_userId_fkey', columns: [table.userId], foreignColumns: [user.id] }).onDelete('cascade').onUpdate('cascade'), uniqueIndex('session_token_key').on(table.token), index('session_userId_idx').on(table.userId)])

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull(),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: date('accessTokenExpiresAt'),
  refreshTokenExpiresAt: date('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [foreignKey({ name: 'account_userId_fkey', columns: [table.userId], foreignColumns: [user.id] }).onDelete('cascade').onUpdate('cascade'), index('account_userId_idx').on(table.userId), uniqueIndex('account_providerId_accountId_key').on(table.providerId, table.accountId)])

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: date('expiresAt').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index('verification_identifier_idx').on(table.identifier)])
