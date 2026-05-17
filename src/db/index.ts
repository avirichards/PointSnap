import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "";

const sql = url.length > 0 && !url.includes("placeholder")
  ? neon(url)
  : (null as unknown as ReturnType<typeof neon>);

export const db = sql
  ? drizzle({ client: sql, schema, casing: "snake_case" })
  : (null as unknown as ReturnType<typeof drizzle>);

export { schema };
