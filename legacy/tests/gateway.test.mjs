import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';

const output = await build({ entryPoints: ['integrations/gateway/worker.ts'], bundle: true, platform: 'neutral', format: 'esm', write: false });
const { default: gateway } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
const environment = {
  SITE_URL: 'https://private.example.test', SITE_SERVICE_TOKEN: 'service-secret',
  SLACK_SIGNING_SECRET: 'slack-secret', GITHUB_WEBHOOK_SECRET: 'github-secret',
};

test('rejects unsigned webhooks without forwarding', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unverified request was forwarded'); };
  try {
    const response = await gateway.fetch(new Request('https://gateway.example.test/webhook/github', { method: 'POST', body: '{}' }), environment);
    assert.equal(response.status, 401);
  } finally { globalThis.fetch = originalFetch; }
});

test('forwards a verified GitHub delivery with the raw body and private Site authorization', async () => {
  const body = '{"action":"opened","repository":{"full_name":"owner/repo"}}';
  const signature = createHmac('sha256', environment.GITHUB_WEBHOOK_SECRET).update(body).digest('hex');
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, init) => { forwarded = { url: String(url), ...init }; return new Response('{"ok":true}', { status: 200 }); };
  try {
    const response = await gateway.fetch(new Request('https://gateway.example.test/webhook/github', {
      method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + signature, 'x-github-delivery': '12345678-1234-1234-1234-123456789abc', 'x-github-event': 'issues' }, body,
    }), environment);
    assert.equal(response.status, 200);
    assert.equal(forwarded.url, 'https://private.example.test/api/integrations/webhook?provider=github');
    assert.equal(forwarded.body, body);
    assert.equal(forwarded.headers.get('OAI-Sites-Authorization'), 'Bearer service-secret');
    assert.equal(forwarded.headers.get('x-github-event'), 'issues');
  } finally { globalThis.fetch = originalFetch; }
});

test('rejects stale Slack requests', async () => {
  const body = '{"type":"url_verification"}';
  const timestamp = String(Math.floor(Date.now() / 1000) - 301);
  const signature = createHmac('sha256', environment.SLACK_SIGNING_SECRET).update('v0:' + timestamp + ':' + body).digest('hex');
  const response = await gateway.fetch(new Request('https://gateway.example.test/webhook/slack', {
    method: 'POST', headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': 'v0=' + signature }, body,
  }), environment);
  assert.equal(response.status, 401);
});
