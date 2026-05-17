import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "";
const configured = url.length > 0 && !url.includes("placeholder");

export const db = configured
  ? drizzle(neon(url), { schema, casing: "snake_case" })
  : (null as unknown as ReturnType<typeof drizzle>);

export { schema };
