import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

let pool: Pool | undefined
let database: ReturnType<typeof drizzle<typeof schema>> | undefined
export function getDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('Account storage is not configured.')
  if (!database) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL })
    database = drizzle(pool, { schema })
  }
  return database
}

export async function closeDatabase() {
  await pool?.end()
  pool = undefined
  database = undefined
}
