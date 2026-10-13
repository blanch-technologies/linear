declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    BOOTSTRAP_OWNER_EMAIL?: string;
    MCP_GATEWAY_SIGNING_SECRET?: string;
    INTEGRATION_ENCRYPTION_KEY?: string;
    SLACK_CLIENT_ID?: string;
    SLACK_CLIENT_SECRET?: string;
    SLACK_SIGNING_SECRET?: string;
    NOTION_CLIENT_ID?: string;
    NOTION_CLIENT_SECRET?: string;
    GITHUB_APP_SLUG?: string;
    GITHUB_APP_ID?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    GITHUB_APP_PRIVATE_KEY?: string;
    GITHUB_WEBHOOK_SECRET?: string;
  }
}
