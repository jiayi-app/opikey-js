# OPIKey SDK and CLI

Official JavaScript/TypeScript tools for [OPIKey](https://opikey.ai): one key for your AI agents to use every API.

| Package | What it does |
|---|---|
| [`@opikey/sdk`](packages/sdk) | Call any API through your OPI Key, load secrets, create sub-keys for sub-agents, run AI mode, and receive webhooks with Inbox. |
| [`@opikey/cli`](packages/cli) | `opi login`, `opi run` (with secrets, or a short-lived sub-key), `opi subkey`, `opi ai`, `opi inbox listen`, `opi setup` and more. |

```bash
npm install @opikey/sdk
npm install --global @opikey/cli
```

Documentation: https://opikey.ai/docs

## Security

Releases are published from this repository by GitHub Actions using npm trusted publishing, with no stored npm tokens. Every release carries an npm provenance attestation linking it to the exact commit and workflow that built it. Releases require maintainer approval.

To report a vulnerability, email agent@opikey.ai. Please don't open a public issue.

## License

MIT
