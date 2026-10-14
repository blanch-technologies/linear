import { request, type FullConfig } from "@playwright/test";
import { emailPrefix, workspacePrefix } from "./support";

/** Deletes this run's WorkOS organizations and users. */
export default async function globalTeardown(config: FullConfig) {
  const use = config.projects[0]!.use;
  const context = await request.newContext({ baseURL: use.baseURL, extraHTTPHeaders: use.extraHTTPHeaders });
  try {
    const response = await context.delete("/api/test-auth", { data: { prefix: workspacePrefix, emailPrefix } });
    if (response.ok()) console.log("e2e cleanup:", await response.text());
  } finally {
    await context.dispose();
  }
}
