import { config } from 'dotenv';

// A separate test DB, never the dev one — `resetDb()` truncates it between
// tests, and running it against .env's DATABASE_URL would be destructive.
config({ path: '.env.test' });
