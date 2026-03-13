# Contributing

Thanks for your interest in contributing to `@yault/aesp`.

## Ground Rules

- Be respectful and collaborative in issues and pull requests.
- Keep changes focused and minimal.
- Include tests for behavior changes and bug fixes.
- Do not include secrets, private keys, or sensitive data in commits.

## Development Setup

1. Fork and clone this repository.
2. Install dependencies:

```bash
npm install
```

3. Build and test:

```bash
npm run build:ts
npm test
```

The WASM build (`npm run build:wasm`) requires the [acegf-wallet](https://github.com/ya-xyz/acegf-wallet) repo as a sibling directory, or set the `ACEGF_ROOT` environment variable. This step is optional for most contributions.

## Project Structure

```
src/
  types/        Shared type definitions
  crypto/       Cryptographic helpers and WASM bridge
  identity/     Agent derivation and identity certificates
  policy/       Policy engine and budget tracking
  negotiation/  Offer/counter-offer state machine
  commitment/   EIP-712 commitment construction
  review/       Human-in-the-loop review queue
  mcp/          MCP tool schemas, server, and stdio transport
  a2a/          Agent-card helpers for cross-agent discovery
  privacy/      Context tagging and address pool management
tests/          Unit tests (vitest)
```

## Branches and Commits

- Create a feature branch from `main`.
- Use clear, descriptive commit messages.
- Keep each commit logically coherent.

## Pull Requests

Please include:

- A short summary of what changed and why.
- Linked issue(s), if applicable.
- Test evidence (`npm test`, and any additional validation).
- Notes on breaking changes or migrations.

Before opening a PR, verify:

- `npm run build:ts` succeeds.
- `npm test` succeeds.
- `npm run lint` passes (or explain deviations).
- Documentation is updated when behavior or public APIs change.

## Reporting Bugs

Use GitHub Issues for normal bugs and feature requests.

For security vulnerabilities, do not open a public issue. See [SECURITY.md](./SECURITY.md).
