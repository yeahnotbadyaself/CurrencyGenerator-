import { createRemoteJWKSet, jwtVerify } from 'jose'

const issuer = 'https://allenstraining.cloudflareaccess.com'
const keys = createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'), { timeoutDuration: 5000 })

// Verify the signature and application audience at the origin, including direct-origin requests.
export async function verifyCloudflareAccess(token, audience = process.env.CF_ACCESS_AUD, keySet = keys) {
  if (typeof token !== 'string' || !token || typeof audience !== 'string' || !audience.trim()) return null
  try {
    const { payload } = await jwtVerify(token, keySet, {
      issuer, audience: audience.trim(), algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub'],
    })
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload : null
  } catch {
    return null
  }
}

const quotas = new Map()
// Per-process protection for authenticated mutations. Apply edge limits across replicas as well.
export function consumeAccessQuota(subject, now = Date.now()) {
  for (const [key, value] of quotas) if (value.expiresAt <= now) quotas.delete(key)
  let quota = quotas.get(subject)
  if (!quota) {
    if (quotas.size >= 10000) return 60
    quota = { count: 0, expiresAt: now + 60000 }
    quotas.set(subject, quota)
  }
  if (quota.count >= 30) return Math.max(1, Math.ceil((quota.expiresAt - now) / 1000))
  quota.count += 1
  return 0
}
