import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { schema } from 'prisma/drizzle/schema'
import { url, object, parse, pipe, string } from 'valibot'

const env = parse(
	object({
		PG_DATABASE_URL: pipe(string(), url()),
	}),
	process.env
)

const queryClient = postgres(env.PG_DATABASE_URL)
export const db = drizzle(queryClient, { schema })
