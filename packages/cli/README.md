# @opikey/cli

The command line for OPIKey, the AI-native API Gateway. Ask any API in plain language, make exact calls and run programs with your secrets, all with one OPI Key. Node 20+.

```bash
npm install --global @opikey/cli
export OPIKEY_KEY=opk_live_...   # your OPI Key, from the OPI Keys page
```

The binary is `opi`, also available as `opikey`.

## With your OPI Key

Commands read the OPI Key from `OPIKEY_KEY` (or the older `OPIKEY`), never from an argument, so it stays out of your shell history.

| Command | What it does |
|---|---|
| `opi "send Sam a receipt for order 1042 with Resend"` | **AI mode.** OPIKey's AI picks the APIs, makes the calls and prints the result on stdout. The calls made and the credits used go to stderr. |
| `opi ai "REQUEST" [--model fast\|smart] [--confirm ID]` | The same, explicitly. `smart` costs much more per request. |
| `opi call API METHOD PATH [--data JSON]` | Exact call through the gateway, e.g. `opi call openai GET /v1/models`. Prints the provider's body, plus a status line with the Firewall verdict and credits. |
| `opi usage` | This month's credits: left, used (API calls, AI mode, AI Firewall) and the reset date. |
| `opi run -- node app.js` | Runs a program with the key's granted secrets in its environment (fetch mode). The OPI Key itself is removed from the program's environment. |

**Previews before risky writes.** When AI mode wants to delete, send to many people, pay or change permissions, it shows the planned calls first. On a terminal it asks you to type `yes`. Without a terminal (agents, scripts), it prints the confirm id and exits 2. Run the same request again with `--confirm ID` to go ahead. A confirm id works once, within 15 minutes.

A single unknown word (a typo) is never sent to AI mode, so a mistyped command doesn't spend credits. Quote your request.

## Signed in as you

- `opi login`: approve the displayed code at the displayed HTTPS page. Only approve a CLI you started.
- `opi keys`: your OPI Keys (names and prefixes only).
- `opi vault`: names of the APIs in your Vault (never values).
- `opi secrets --key NAME`: the secrets a key can use (names only).
- `opi run --key NAME -- node app.js`: run a program with that key's secrets.
- `opi setup --client <claude-code|cursor|vscode|windsurf|gemini|codex|other> [--secrets a,b | --all-secrets]`: creates an OPI Key for an agent, adds it to that agent's MCP settings and checks it works. The key is never printed. If a config file can't be edited safely, it's left unchanged and the key is saved to `~/.config/opikey/agent.env` instead. Options: `--name`, `--expires-days N` (up to 365).
- `opi logout`: revoke the session and erase its local credential.

CLI sessions last 30 days and rotate on each use. The OS keychain is preferred; if it's unavailable, the CLI warns and uses `~/.config/opikey/credentials` with mode 0600. That file stores only the CLI session token, never provider credentials.

Exit codes: 0 success, 1 request failed or blocked, 2 waiting for your confirmation, 64 usage error, 130 stopped.

## Secret names in `opi run`

Secrets are passed as environment variables. Names that are already valid variable names are kept. Others are uppercased with every other character turned into `_` (`httpbin-test` becomes `HTTPBIN_TEST`). If two secrets would map to the same name, `opi run` stops with an error instead of overwriting one.

## Upgrading from 0.4

- New: AI mode as the default command, `opi call` and `opi usage`.
- The key variable is now `OPIKEY_KEY`. `OPIKEY` still works.
- Removed with the features they used: `opi subkey`, `opi inbox`, `opi whoami` and `opi run --subkey`.
- `opi credits` now shows the same output as `opi usage`.
