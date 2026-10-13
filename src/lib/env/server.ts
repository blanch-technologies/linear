import "server-only";
import { parseEnv, serverSchema, workosRedirectUri } from "./schema";

export const serverEnv = parseEnv("server", serverSchema, process.env);
export const redirectUri = workosRedirectUri(serverEnv);
