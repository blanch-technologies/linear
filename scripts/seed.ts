/** `pnpm seed`: (re)seed demo data into the current Convex deployment. */
import { execFileSync } from "node:child_process";

execFileSync("pnpm", ["exec", "convex", "run", "seed:run"], { stdio: "inherit" });
