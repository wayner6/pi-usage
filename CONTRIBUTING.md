# Contributing

1. Create a focused branch.
2. Run `npm install`.
3. Run `npm run verify` before opening a pull request.
4. Add offline fixtures for new provider response shapes; never commit live credentials or raw account exports.
5. Keep adapters capability-driven. UI code must not hard-code provider-specific response fields.
6. New authenticated endpoints must document their trust boundary and reject cross-origin redirects.
