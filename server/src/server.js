import 'dotenv/config';
import { createApp } from './app.js';
import { createDatabase } from './db/connection.js';
import { migrateDatabase } from './db/migrate.js';

const database = createDatabase();
migrateDatabase(database);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const server = createApp(database).listen(port, host, () => {
  console.log(`API disponible en http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);