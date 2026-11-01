import { createApp } from './app.js'
import { db } from './db.js'
const app = createApp()
const server = app.listen(process.env.PORT ?? 3000, () =>
  console.log('Commonroom API is ready'),
)
async function shutdown() {
  server.close(async () => {
    await app.locals.close()
    await db.$disconnect()
    process.exit(0)
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
