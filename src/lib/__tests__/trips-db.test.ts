import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
const db = new PGlite(),
  alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222",
  trip = "33333333-3333-4333-8333-333333333333";
beforeAll(async () => {
  await db.exec(
    `CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${alice}'),('${bob}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE SQL AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;GRANT USAGE ON SCHEMA public,auth TO authenticated;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`,
  );
  const sql = readFileSync(
    "supabase/migrations/20260906010000_private_trips.sql",
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(
    `SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${alice}',false);INSERT INTO trips(id,user_id,name) VALUES('${trip}','${alice}','London');INSERT INTO trip_flights(trip_id,user_id,leg,snapshot) VALUES('${trip}','${alice}','outbound','{"points":50000}');`,
  );
}, 30000);
afterAll(() => db.close());
it("persists owner trips and flight choices", async () => {
  expect((await db.query("SELECT name FROM trips")).rows).toEqual([
    { name: "London" },
  ]);
  expect((await db.query("SELECT leg FROM trip_flights")).rows).toEqual([
    { leg: "outbound" },
  ]);
});
it("blocks reading or attaching a flight to another user's trip", async () => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${bob}',false);`);
  expect((await db.query("SELECT * FROM trips")).rows).toHaveLength(0);
  expect((await db.query("SELECT * FROM trip_flights")).rows).toHaveLength(0);
  await expect(
    db.exec(
      `INSERT INTO trip_flights(trip_id,user_id,leg,snapshot) VALUES('${trip}','${bob}','return','{}')`,
    ),
  ).rejects.toThrow();
  await expect(
    db.exec(
      `INSERT INTO trip_flights(trip_id,user_id,leg,snapshot) VALUES('${trip}','${alice}','return','{}')`,
    ),
  ).rejects.toThrow();
  await db.exec("DELETE FROM trips;DELETE FROM trip_flights;");
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${alice}',false);`);
  expect((await db.query("SELECT * FROM trip_flights")).rows).toHaveLength(1);
});
it("rejects invalid legs and cascades owner deletions", async () => {
  await expect(
    db.exec(`UPDATE trip_flights SET leg='unknown'`),
  ).rejects.toThrow();
  await db.exec("DELETE FROM trips");
  expect((await db.query("SELECT * FROM trip_flights")).rows).toHaveLength(0);
});
