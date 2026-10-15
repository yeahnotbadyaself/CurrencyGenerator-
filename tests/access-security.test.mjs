import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose'
import { verifyCloudflareAccess, consumeAccessQuota } from '../security/cloudflare-access.mjs'

const issuer = 'https://allenstraining.cloudflareaccess.com'
const audience = 'security-test-app'
const fixture = (async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  return { privateKey, keys: createLocalJWKSet({ keys: [{ ...jwk, alg: 'RS256', kid: 'fixture' }] }) }
})()
async function token(overrides = {}) {
  const { privateKey } = await fixture
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ sub: 'dummy-user', iss: issuer, aud: audience, iat: now, exp: now + 60, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(privateKey)
}

test('accepts a signed token for this application', async () => {
  const { keys } = await fixture
  assert.equal((await verifyCloudflareAccess(await token(), audience, keys))?.sub, 'dummy-user')
})
test('rejects missing tokens, identity-header strings, and absent audience configuration', async () => {
  const { keys } = await fixture
  for (const value of [undefined, null, '', 'staff@example.invalid']) {
    assert.equal(await verifyCloudflareAccess(value, audience, keys), null)
  }
  assert.equal(await verifyCloudflareAccess(await token(), '', keys), null)
  assert.equal(await verifyCloudflareAccess(await token(), '   ', keys), null)
})
test('rejects wrong issuer, wrong audience, expired tokens, and missing required claims', async () => {
  const { keys } = await fixture
  for (const claims of [{ iss: 'https://other-team.cloudflareaccess.com' }, { aud: 'other-app' }, { exp: 1 }, { exp: undefined }, { iat: undefined }, { sub: undefined }, { sub: '' }]) {
    assert.equal(await verifyCloudflareAccess(await token(claims), audience, keys), null)
  }
})
test('rejects forged signatures and unsigned tokens', async () => {
  const { keys } = await fixture
  const parts = (await token()).split('.')
  parts[2] = 'A'.repeat(parts[2].length)
  assert.equal(await verifyCloudflareAccess(parts.join('.'), audience, keys), null)
  assert.equal(await verifyCloudflareAccess('eyJhbGciOiJub25lIn0.eyJzdWIiOiJkdW1teS11c2VyIn0.', audience, keys), null)
})
test('rejects unavailable signing keys', async () => {
  assert.equal(await verifyCloudflareAccess(await token(), audience, async () => { throw new Error('fixture key lookup unavailable') }), null)
})
test('limits authenticated requests by subject and resets expired windows', () => {
  for (let i = 0; i < 30; i++) assert.equal(consumeAccessQuota('quota-user-a', 1000), 0)
  assert.equal(consumeAccessQuota('quota-user-a', 1000), 60)
  assert.equal(consumeAccessQuota('quota-user-b', 1000), 0)
  assert.equal(consumeAccessQuota('quota-user-a', 61000), 0)
})
