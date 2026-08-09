process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/ledger_test';
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
