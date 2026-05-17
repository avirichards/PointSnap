import "./_loadEnv";
import { runSeed } from "./run";

async function main() {
  console.log("Running seed against", process.env.DATABASE_URL?.split("@")[1] ?? "(no DB URL)");
  const summary = await runSeed();
  console.log("✓ seed complete", summary);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
