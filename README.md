# OPIKey SDK and CLI

Official JavaScript/TypeScript tools for [OPIKey](https://opikey.ai), the AI-native API Gateway. Put every API key in one Vault, then call any API with one OPI Key: directly, or in plain language with AI mode. The AI Firewall checks every request and response.

| Package | What it does |
|---|---|
| [`@opikey/sdk`](packages/sdk) | `opi.ai()` for plain-language requests, `opi.call()` for exact calls, `opi.usage()` for credits, and fetch-mode secret loading. |
| [`@opikey/cli`](packages/cli) | `opi "request"` (AI mode), `opi call`, `opi usage`, `opi run` and `opi login`. The binary is `opi`, also available as `opikey`. |

```bash
npm install @opikey/sdk
npm install --global @opikey/cli
```

Everything authenticates with an OPI Key, read from the `OPIKEY_KEY` environment variable. Never put an OPI Key in browser code.

Documentation: https://opikey.ai/docs

## Security

Releases are published from this repository by GitHub Actions using npm trusted publishing, with no stored npm tokens. Every release carries an npm provenance attestation linking it to the exact commit and workflow that built it. Releases require maintainer approval.

To report a vulnerability, email agent@opikey.ai. Please don't open a public issue.

## License

MIT
