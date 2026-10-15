# Access configuration required before deployment

All application routes require a valid Cloudflare Access JWT from the Allens Training team. Direct-origin requests, forged identity headers, invalid signatures, expired tokens, and missing configuration are denied.

1. Put the application hostname behind a Cloudflare Access self-hosted application.
2. Configure an explicit allow policy for the staff who should use this app. Avoid public bypass policies.
3. Set CF_ACCESS_AUD on the application server to that application's Audience (AUD) tag. This value is configuration, not a password. Keep OPENAI_API_KEY server-side.
4. Deploy, then use the Access-protected hostname. Do not use the raw hosting URL as the user-facing URL.
5. Verify the protected hostname works after sign-in and that requests without a valid token to the direct origin receive HTTP 403. A GET /api/health probe is the only public application route.
6. Apply Cloudflare rate limits and provider spending limits. The application also limits authenticated mutations to 30 per minute per subject per process; it is not a distributed spending cap.

Missing CF_ACCESS_AUD deliberately denies access. There is no environment or localhost bypass. Local development also requires a valid Access identity, for example through a development Access application and tunnel.

Before merging/deploying, complete configuration and run the security regression tests plus the normal build in an isolated environment. This change does not remove previously exposed data from Git history or secure unrelated services.
