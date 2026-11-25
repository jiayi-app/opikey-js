# @opikey/cli

Node 20+.

```bash
npm install --global @opikey/cli
```

## Set up with your agent

The easiest start: tell your coding agent `Set up OPIKey by following https://opikey.ai/get-started.md`. It runs these for you:

- `opi login`: you approve the code in your browser.
- `opi vault`: lists the names of the APIs saved in your vault (never values), so the agent can ask which it may use.
- `opi setup --client <claude-code|cursor|vscode|windsurf|gemini|codex|other> [--secrets a,b | --all-secrets]`: creates an OPI Key for that agent (named like "Cursor on MacBook", gateway mode only, sub-keys allowed, 90-day expiry by default), writes it straight into the agent's MCP settings, and checks it works. The key is never printed. Config files it writes are made readable only by you. If a config file can't be edited safely, it's left unchanged and the key is saved to `~/.config/opikey/agent.env` instead, with instructions. Options: `--name`, `--expires-days N` (up to 365), `--no-subkeys`.

The new key is a normal OPI Key: it appears on your OPI Keys page, where you can change its APIs, limits and expiry, or revoke it.

## Signed in as you

- `opi login`: approve the displayed code at the displayed HTTPS page. Only approve a CLI you started. Authenticator verification is required when enabled.
- `opi keys`: list OPI Key metadata.
- `opi secrets --key agent`: list granted secret metadata.
- `opi run --key agent -- node app.js`: inject granted values into only the child process environment. The key must have fetch mode enabled. No secret values are printed or written to disk.
- `opi logout`: revoke the session and erase its local credential.

CLI tokens last 30 days and rotate on each authenticated use. Run only one CLI operation at a time: concurrent reuse revokes the session, by design. The OS keychain is preferred; unavailable keychains produce a warning and use `~/.config/opikey/credentials` with mode 0600. That file stores only the CLI session token, never provider credentials.

## As an agent (OPI Key in `OPIKEY`)

These commands read the OPI Key from the `OPIKEY` environment variable, never from an argument, so it doesn't end up in your shell history.

| Command | What it does |
|---|---|
| `opi run --subkey -- node agent.js` | **Safest way to run an agent.** Creates a short-lived, gateway-only sub-key, gives the program only that as `OPIKEY` (no raw secrets, not your key), and revokes it when the program exits. Options: `--ttl SECONDS` (default 3600), `--secrets a,b`, `--max-calls N`, `--budget CREDITS`. Your key needs "Allow sub-keys". |
| `opi run -- command` | Loads granted secret values into the child environment (fetch mode). The OPI Key itself is removed from the child. |
| `opi whoami` | This key's limits, credit budget, secrets and chain. |
| `opi credits` | Account credit balance (root keys only). |
| `opi subkey create --ttl 3600 [--name N] [--task T] [--secrets a,b] [--max-calls N] [--budget CREDITS] [--delegate] [--role R]` | Prints `OPIKEY=…` (shown once) on stdout and everything else on stderr, so `opi subkey create … > child.env` saves only the key. |
| `opi subkey list` / `revoke ID` / `pause ID` / `resume ID` | Manage direct sub-keys. Revoke and pause apply to the whole subtree. |
| `opi ai "task" [--wait SECONDS]` | AI mode. Prints the answer. Exits 2 with the run id when a write is waiting for your approval; `--wait` waits and continues. |
| `opi inbox list` | Your inboxes and their receiving URLs. |
| `opi inbox create --name N --source github --generate` | Create a webhook inbox and print its receiving URL. Sources: `stripe`, `github`, `standard_webhooks`, `slack`, `generic_hmac`, `none`. Use `--secret-name NAME` for a signing secret already in your vault. |
| `opi inbox listen ID [--forward http://localhost:3000/hook] [--type T]` | Print messages as JSON lines, or forward each to your local app. Messages are acked only after a 2xx; otherwise they are redelivered. Ctrl+C stops. Forwarding is limited to `https://` and `http://localhost`. |
| `opi apis [query]` | APIs that offer instant accounts. |
| `opi connect PROVIDER [--plan P] [--wait SECONDS]` | Get an instant account. Prints the vault secret name (never a key). Exits 2 when you must approve it first. |

Exit codes: 0 success, 1 request failed, 2 waiting for you (approval or payment), 64 usage error, 130 stopped.

## Secret names in `opi run`

Secrets are passed as environment variables. Names that are already valid variable names are kept; others are uppercased with every other character turned into `_` (`httpbin-test` becomes `HTTPBIN_TEST`). If two secrets would map to the same variable name, `opi run` stops with an error instead of overwriting one.
