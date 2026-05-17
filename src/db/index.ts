import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "";

const client =
  url.length > 0 && !url.includes("placeholder")
    ? postgres(url, { prepare: false, max: 10 })
    : (null as unknown as ReturnType<typeof postgres>);

export const db = client
  ? drizzle(client, { schema, casing: "snake_case" })
  : (null as unknown as ReturnType<typeof drizzle>);

export { schema };
