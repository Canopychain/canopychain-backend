-- Run once, on first container startup, alongside the default POSTGRES_DB —
-- gives the integration test suite (see .env.test.example) its own
-- database so `resetDb()` never runs anywhere near dev data.
CREATE DATABASE canopychain_test;
