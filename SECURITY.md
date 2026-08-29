# Security

Pi Usage runs as a Pi extension with the user's local permissions. Review extensions before installing them.

## Credential policy

- Provider credentials are resolved through Pi at runtime and are never written by Pi Usage.
- CLIProxyAPI quota access uses an ordinary inference API key through `pi-bridge`; management keys are unsupported.
- Authenticated requests stay on the configured provider origin. Cross-origin redirects are rejected.
- Browser cookies, local storage, and private provider dashboard sessions are not read.
- Quota responses are cached in memory only.

## Reporting

Do not include API keys, management passwords, full auth files, or raw Authorization headers in issues. Revoke exposed credentials immediately.
