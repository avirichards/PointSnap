import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
const pg = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  await pg.exec(
    `CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${alice}'),('${bob}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE SQL AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`,
  );
  const sql = readFileSync(
    "supabase/migrations/20260905010000_personal_wallet.sql",
    "utf8",
  );
  await pg.exec(sql);
  await pg.exec(sql);
  await pg.exec(
    `SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${alice}',false);`,
  );
}, 30000);
afterAll(() => pg.close());
it("persists balances/cards and rejects invalid balances", async () => {
  await pg.exec(
    `INSERT INTO wallet_entries(user_id,asset_id,kind,balance) VALUES('${alice}','AMEX_MR','currency',100000);INSERT INTO wallet_cards(user_id,name) VALUES('${alice}','Travel card');`,
  );
  expect((await pg.query("SELECT balance FROM wallet_entries")).rows).toEqual([
    { balance: 100000 },
  ]);
  await expect(
    pg.exec(`UPDATE wallet_entries SET balance=-1`),
  ).rejects.toThrow();
});
it("RLS isolates read, write and delete across accounts", async () => {
  await pg.exec(`SELECT set_config('request.jwt.claim.sub','${bob}',false);`);
  expect((await pg.query("SELECT * FROM wallet_entries")).rows).toHaveLength(0);
  expect((await pg.query("SELECT * FROM wallet_cards")).rows).toHaveLength(0);
  await expect(
    pg.exec(
      `INSERT INTO wallet_entries(user_id,asset_id,kind,balance) VALUES('${alice}','CHASE_UR','currency',42)`,
    ),
  ).rejects.toThrow();
  await pg.exec("DELETE FROM wallet_entries;DELETE FROM wallet_cards;");
  await pg.exec(`SELECT set_config('request.jwt.claim.sub','${alice}',false);`);
  expect((await pg.query("SELECT * FROM wallet_entries")).rows).toHaveLength(1);
  expect((await pg.query("SELECT * FROM wallet_cards")).rows).toHaveLength(1);
});
it("allows owner updates and removal", async () => {
  await pg.exec(
    `UPDATE wallet_entries SET balance=90000;DELETE FROM wallet_cards;`,
  );
  expect((await pg.query("SELECT balance FROM wallet_entries")).rows).toEqual([
    { balance: 90000 },
  ]);
  expect((await pg.query("SELECT * FROM wallet_cards")).rows).toHaveLength(0);
});
