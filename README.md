# Genova Control Board

A Stream Deck plugin that pilots **any** Hermes Agent installation from the hardware.

Hermes ships an HTTP dashboard; this plugin talks to it directly. No local daemon, no
hardcoded paths, no wrapper script: point a key at a gateway URL and it works — on the
machine running Hermes, or across the network on another one.

![actions](com.genova.control-board.sdPlugin/imgs/plugin/marketplace@2x.png)

## What it does

Four actions, each drawn as a live 144×144 tile, refreshed every 3 seconds:

| Action | Shows | On click |
|---|---|---|
| **Hermes Gateway** | `ON` / `OFF` / `DOWN`, plus the active profile or the Hermes version | restarts (or starts / stops) the gateway, then waits until it answers again |
| **Hermes Model** | the model actually configured on the gateway | applies the provider/model stored in the key |
| **Hermes Cron** | the last run status of one scheduled job | triggers that job immediately |
| **Hermes Metric** | CPU, RAM, disk, sessions, messages or uptime | forces a fresh read |

Keys are rendered as SVG tiles inside the plugin, so there is nothing to configure
visually: install, drop a key, done. Colors follow the state — green for healthy, blue
for informational, orange at 70 %, red at 90 % or on failure.

## Requirements

- Stream Deck 6.6 or newer (Windows 10+ / macOS 12+).
- A reachable Hermes gateway (default `http://localhost:9119` — the value printed by
  `hermes dashboard`).
- Node.js 20 only for building from source; the shipped plugin bundles everything.

## Install

### From a release

1. Download `com.genova.control-board.streamDeckPlugin` from the Releases page.
2. Double-click it. Stream Deck asks to install the plugin — accept.

### From source

```bash
git clone https://github.com/<you>/genova-control-board.git
cd genova-control-board
npm install
npm run build            # produces com.genova.control-board.sdPlugin/bin/plugin.js
npm run icons            # regenerates the PNG icons (needs Pillow)
npx streamdeck pack com.genova.control-board.sdPlugin   # optional: build the installer
```

Then either double-click the generated `.streamDeckPlugin`, or copy the whole
`com.genova.control-board.sdPlugin` folder into:

- Windows — `%APPDATA%\Elgato\StreamDeck\Plugins\`
- macOS — `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`

and restart Stream Deck.

## Configuration

Everything is **global**: the gateway URL and token are shared by every key, and can be
edited from the property inspector of any of them.

- **URL** — empty means `http://localhost:9119`. A bare host works too (`192.168.1.20:9119`).
- **Token** — leave empty. See below.

### Why the token is optional

Hermes' dashboard injects a per-session token into its own HTML
(`window.__HERMES_SESSION_TOKEN__`) and requires it as `X-Hermes-Session-Token` for
sensitive endpoints (`/api/system/stats`, `/api/cron/jobs`, `/api/profiles/active`, …).

The plugin reads that value exactly the way the web interface does: `GET /`, regex, done.
It caches it per URL and re-discovers it automatically on a `401` — which is the normal
case after a gateway restart, since the token is regenerated each time.

Open endpoints (`/api/health`, `/api/status`, `/api/model/info`) need no token at all, so
the Gateway and Model keys work even on an install whose dashboard sits behind an OAuth
gateway (`auth_required: true`). Only then must you paste a token by hand.

## Endpoints used

| Endpoint | Used by |
|---|---|
| `GET /api/health` | Gateway key — is the HTTP server alive, what version |
| `GET /api/status` | Gateway key — is the agent runtime actually running |
| `POST /api/gateway/{start,stop,restart}` | Gateway key |
| `GET /api/model/info` | Model key |
| `POST /api/model/set` | Model key (scope `main`) |
| `GET /api/cron/jobs` | Cron key, and the job dropdown in the property inspector |
| `POST /api/cron/jobs/{id}/trigger` | Cron key |
| `GET /api/system/stats` | Metric key (CPU, RAM, disk, uptime) |
| `GET /api/sessions/stats` | Metric key (sessions, messages) |
| `GET /api/profiles/active` | Gateway key — footnote |

Responses are cached per endpoint (2.5 s to 6 s depending on the data), so ten keys cost
one request each per tick, not ten. Transport failures are never cached: a gateway coming
back is visible on the very next refresh.

## Design notes

- **The state shown is always read from the gateway**, never inferred from the last click.
  A key that lies about reality is worse than no key.
- **A restart closes the socket.** The plugin treats the `200` on `/api/gateway/restart` as
  "scheduled", then polls `/api/health` until the server answers again (up to 60 s).
- **`POST /api/model/set` writes `config.yaml`** and applies to *new* sessions only. A
  running chat switches with its own `/model` command; the key shows the configured value.
- `play`-style per-key overrides are deliberately absent: one board, one gateway.

## Development

```bash
npm run watch     # rebuild on save
```

`src/lib/gateway.ts` holds the whole API client (token discovery, retry-on-401, cache) and
is usable on its own — it is plain `fetch`, no Stream Deck dependency:

```bash
npx tsc src/lib/gateway.ts src/lib/diag.ts --outDir /tmp/gcb \
  --module es2022 --moduleResolution bundler --target es2022 --skipLibCheck
node -e "import('/tmp/gcb/gateway.js').then(async m => console.log(await m.fetchHealth()))"
```

## License

MIT — see [LICENSE](LICENSE).
