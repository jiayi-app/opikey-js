# @opikey/cli

The command line for OPIKey, the AI-native API Gateway. Ask any API in plain language, make exact calls and run programs with your secrets, all with one OPI Key. Node 20+.

```bash
npm install --global @opikey/cli
opi login      # approve a new OPI Key for this computer in your browser
opi import     # bring the API keys in ./.env into your Vault
opi "what APIs can I use?"
```

The binary is `opi`, also available as `opikey`.

## Sign in

- `opi login` opens your browser. Check that the code matches, choose what the key can use (all APIs in your Vault by default), and approve. OPIKey creates a normal OPI Key named after this computer, like "CLI on MacBook". It's listed on your OPI Keys page, where you can change its access or revoke it. The key is saved in your OS keychain and never printed. If the keychain is unavailable, the CLI warns and uses `~/.config/opikey/credentials` with mode 0600.
- `opi logout` revokes that key and removes it from this computer.
- `opi whoami` shows which key is in use, where it came from, and what it can do.

For CI and scripts, set `OPIKEY_KEY` instead (the older `OPIKEY` also works). A key in the environment takes precedence over the one from `opi login`. The key is never read from an argument, so it stays out of your shell history.

## Commands

| Command | What it does |
|---|---|
| `opi "send Sam a receipt for order 1042 with Resend"` | **AI mode.** OPIKey's AI picks the APIs, makes the calls and prints the result on stdout. The calls made and the credits used go to stderr. |
| `opi ai "REQUEST" [--model fast\|smart] [--confirm ID]` | The same, explicitly. `smart` costs much more per request. |
| `opi call API METHOD PATH [--data JSON]` | Exact call through the gateway, e.g. `opi call openai GET /v1/models`. Prints the provider's body, plus a status line with the Firewall verdict and credits. |
| `opi apis` | The APIs this key can use (names only, never values). |
| `opi usage` | This month's credits: left, used (API calls, AI mode, AI Firewall) and the reset date. |
| `opi import [FILE] [--yes] [--remove] [--replace] [--all]` | Brings the API keys in a `.env` file (default `./.env`) into your Vault. See below. |
| `opi skill install --agent claude-code\|codex\|openclaw\|hermes\|agents` | Teaches an AI agent to use OPIKey by writing the OPIKey `SKILL.md` into its skills folder. `opi skill show` prints it. |
| `opi run -- node app.js` | Runs a program with the key's granted secrets in its environment (fetch mode). The OPI Key itself is removed from the program's environment. |

**Previews before risky writes.** When AI mode wants to delete, send to many people, pay or change permissions, it shows the planned calls first. On a terminal it asks you to type `yes`. Without a terminal (agents, scripts), it prints the confirm id and exits 2. Run the same request again with `--confirm ID` to go ahead. A confirm id works once, within 15 minutes.

A single unknown word (a typo) is never sent to AI mode, so a mistyped command doesn't spend credits. Quote your request.

Exit codes: 0 success, 1 request failed or blocked, 2 waiting for your confirmation, 64 usage error, 130 stopped.

## Bring your API keys over: `opi import`

`opi import` reads a `.env` file, picks out the API keys and shows you the list with masked values. Nothing is sent until you type `yes` (or pass `--yes`). Values are never printed.

- It skips settings that aren't secrets (`NODE_ENV`, `PORT`, booleans, numbers), public variables (`NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_` and similar) and your OPI Key. `--all` includes everything that isn't public.
- Keys already in your Vault are kept. `--replace` overwrites them.
- `--remove` deletes the imported lines from the file afterwards and adds a comment pointing to `opi run`. Other lines are left alone.
- Your key needs the "Can add APIs to the Vault" permission. Keys from `opi login` have it.

Then run your app with `opi run -- npm start`. Importing doesn't un-leak a key: rotate any key that was ever committed or shared.

## Use OPIKey from an AI agent: `opi skill install`

```bash
opi login
opi skill install --agent claude-code   # or codex, openclaw, hermes, agents
```

This writes `SKILL.md` to the agent's personal skills folder:

| Agent | Folder |
|---|---|
| Claude Code | `~/.claude/skills/opikey/` |
| Codex, and other agents that read `~/.agents/skills` | `~/.agents/skills/opikey/` |
| OpenClaw | `~/.openclaw/skills/opikey/` |
| Hermes Agent | `~/.hermes/skills/opikey/` |

Restart the agent. It then runs `opi` commands with the key from `opi login`, and stops for your confirmation before risky writes. The skill contains no key. Step-by-step setup for each tool, including app builders like Lovable, Replit and Base44, is at [opikey.ai/connect/integrations](https://opikey.ai/connect/integrations).

## Secret names in `opi run`

Secrets are passed as environment variables. Names that are already valid variable names are kept. Others are uppercased with every other character turned into `_` (`httpbin-test` becomes `HTTPBIN_TEST`). If two secrets would map to the same name, `opi run` stops with an error instead of overwriting one.

## New in 0.6

`opi import` and `opi skill install`. Requires `@opikey/sdk` 0.5.

## Upgrading from 0.4

- New: AI mode as the default command, `opi call` and `opi usage`.
- The key variable is now `OPIKEY_KEY`. `OPIKEY` still works.
- `opi login` now creates a revocable OPI Key for this computer instead of a session. Run it again after upgrading.
- `opi vault` is now `opi apis` (the old name still works), and `opi whoami` shows the key in use.
- `opi run` uses the key from `opi login` or `OPIKEY_KEY`; `--key NAME` is gone.
- Removed: `opi keys`, `opi secrets`, `opi setup`, `opi subkey`, `opi inbox` and `opi run --subkey`. Manage keys on the OPI Keys page.
- `opi credits` now shows the same output as `opi usage`.
