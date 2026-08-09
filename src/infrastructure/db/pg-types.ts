import { types } from 'pg';

/**
 * node-postgres maps BIGINT (oid 20) to a string by default. Our identity ids and
 * per-account sequence numbers stay well within the safe integer range, so parse
 * them to numbers. Import this module once before any Pool is created.
 */
types.setTypeParser(20, (value: string | null) =>
  value === null ? null : Number(value),
);