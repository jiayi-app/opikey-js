# @opikey/cli

Node 20+. `npm install -g @opikey/cli` after the first trusted publication.

- `opi login`: approve the displayed code at the displayed HTTPS page. Only approve a CLI you started. Authenticator verification is required when enabled.
- `opi keys`: list OPI Key metadata.
- `opi secrets --key agent`: list granted secret metadata.
- `opi run --key agent -- node app.js`: inject granted values into only the child process environment. The key must have fetch mode enabled. No secret values are printed or written to disk.
- `opi logout`: revoke the session and erase its local credential.

CI can provide `OPIKEY` and use `opi run -- command` without a login. The OPI Key itself is removed from the child environment. CLI tokens last 30 days and rotate on each authenticated use. Run only one CLI operation at a time: concurrent reuse revokes the session, by design. The OS keychain is preferred; unavailable keychains produce a warning and use `~/.config/opikey/credentials` with mode 0600. The fallback file stores only the CLI session token, never provider credentials. Never include that file in backups or CI artifacts.
