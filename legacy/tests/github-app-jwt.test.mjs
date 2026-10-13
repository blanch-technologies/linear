import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { build } from 'esbuild';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
globalThis.__testEnv = {
  GITHUB_APP_ID: '12345',
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
};
const output = await build({
  entryPoints: ['lib/integrations/github.ts'], bundle: true, platform: 'neutral', format: 'esm', write: false,
  plugins: [{ name: 'worker-env-test', setup(bundler) {
    bundler.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'worker-env-test', namespace: 'test' }));
    bundler.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const env = globalThis.__testEnv;', loader: 'js' }));
  } }],
});
const { githubAppJwt } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));

test('GitHub App JWT signs with a PKCS#1 private key and has short expiry', async () => {
  const jwt = await githubAppJwt();
  const [header, payload, signature] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url').toString()).alg, 'RS256');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(claims.iss, '12345');
  assert.ok(claims.exp - claims.iat <= 600);
  assert.ok(verify('RSA-SHA256', Buffer.from(header + '.' + payload), publicKey, Buffer.from(signature, 'base64url')));
});
