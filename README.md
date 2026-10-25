# Genova Control Board

Un **plugin Hermes** qui embarque un **plugin Stream Deck** : une seule installation côté
Hermes, et le board arrive avec. Deux outils le posent sur la machine, le mettent à jour et
vérifient qu'il est réellement fonctionnel.

```
hermes plugins install Gabryel666/genova-control-board
```

Après redémarrage de la passerelle, il suffit de demander « installe le board ».

---

## En bref

Quatre touches Stream Deck pilotent n'importe quelle instance Hermes : l'état du gateway
(et son redémarrage), le modèle actif (et son changement), une tâche planifiée (et son
déclenchement immédiat), une métrique live — mémoire, processeur, disque, sessions,
messages, uptime.

Rien à dessiner ni à configurer sur une installation locale : les touches sont générées
par le plugin en 144×144 avec des couleurs d'état, et l'adresse par défaut est
`http://localhost:9119`. Seul le cas d'un Hermes distant demande de saisir son adresse
dans les réglages d'une touche.

## Installation, pas à pas

1. Installer le plugin dans Hermes (commande ci-dessus), puis redémarrer la passerelle :
   un plugin ne se charge qu'au démarrage du processus.
2. Demander l'installation du board. L'outil `streamdeck_board_install` copie le board dans
   le dossier de Stream Deck, sauvegarde la version précédente dans
   `StreamDeck/Backups/genova-control-board/`, relance l'application et vérifie son PID.
3. Poser les touches : catégorie « Genova Control Board » dans Stream Deck, glisser sur une
   case libre. Aucune touche n'est posée automatiquement — la disposition du deck appartient
   à son propriétaire.

## Les deux outils

`streamdeck_board_status` ne devine jamais : version installée comparée à celle embarquée,
Stream Deck en cours d'exécution ou non, et surtout **chacun des points d'entrée du board
répond-il sur cette machine** (`/api/health`, `/api/status`, `/api/model/info`,
`/api/system/stats`, `/api/sessions/stats`, `/api/cron/jobs`, `/api/profiles/active`). C'est
ce qui transforme « fonctionne sur n'importe quel Hermes » en mesure au lieu d'une promesse.

`streamdeck_board_install` détecte seul le dossier de plugins (Windows, WSL via `/mnt/c`,
macOS), refuse de toucher un dossier qui appartient à un autre plugin, sauvegarde avant
d'écraser, et rapporte franchement un échec de relance au lieu de le masquer.

---

# Technical reference

A Stream Deck plugin that pilots **any** Hermes Agent installation, shipped inside a Hermes
plugin. The board talks to the dashboard's HTTP API — no local daemon, no hardcoded paths,
no wrapper script.

## Layout

```
plugin.yaml                 manifeste du plugin Hermes (2 outils déclarés)
__init__.py                 enregistrement des outils
board.py                    détection, installation, sondes — stdlib uniquement
assets/com.genova.control-board.sdPlugin/    board prêt à installer (commité)
streamdeck/                 sources TypeScript du board
  src/lib/gateway.ts        client de l'API Hermes (jeton, cache, retry)
  src/lib/render.ts         tuiles SVG 144×144
  src/actions/              status, model, cron, metric
  sync_assets.py            assemble assets/ depuis les sources
```

## Actions

| Action | Shows | On click |
|---|---|---|
| **Hermes Gateway** | `ON` / `OFF` / `DOWN`, plus the active profile or the version | restarts (or starts / stops) the gateway, then waits until it answers |
| **Hermes Model** | the model actually configured on the gateway | applies the provider/model stored in the key |
| **Hermes Cron** | the last run status of one scheduled job | triggers that job immediately |
| **Hermes Metric** | CPU, RAM, disk, sessions, messages or uptime | forces a fresh read |

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

## Authentication

The dashboard injects a per-session token into its own HTML
(`window.__HERMES_SESSION_TOKEN__`) and requires it as `X-Hermes-Session-Token` for
sensitive endpoints. The board reads it the same way a browser does (`GET /`, then a
regex), caches it per URL, and re-discovers it automatically on a `401` — which is the
normal case after a gateway restart, since the token is minted per process.

Open endpoints (`/api/health`, `/api/status`, `/api/model/info`) need no token, so the
Gateway and Model keys still work on an install whose dashboard sits behind an OAuth gate.
Only then must a token be pasted by hand.

Responses are cached per endpoint (2.5 s to 6 s), so ten keys cost one request each per
tick. Transport failures are never cached: a gateway coming back shows up on the next tick.

## Build

```bash
cd streamdeck
npm install
npm run build      # compile into assets/ and sync manifest, ui/, imgs/
npm run icons      # regenerate the PNG icons (needs Pillow)
```

Then, from the repository root:

```bash
hermes plugins validate .          # manifest, load, declared tools, security scan
hermes plugins doctor .            # real runtime contracts
python3 -c "import board; print(board.summarise(board.status()))"
```

`streamdeck/src/lib/gateway.ts` is a standalone client and can be exercised without Stream
Deck:

```bash
npx tsc streamdeck/src/lib/gateway.ts streamdeck/src/lib/diag.ts --outDir /tmp/gcb \
  --module es2022 --moduleResolution bundler --target es2022 --skipLibCheck
```

## Design notes

- **The state shown is always read from the gateway**, never inferred from the last click.
- **A restart closes the socket.** The `200` on `/api/gateway/restart` means "scheduled";
  the key then polls `/api/health` until the server answers again (up to 60 s).
- **`POST /api/model/set` writes `config.yaml`** and applies to *new* sessions only.
- **Keys are drawn as SVG** at 144×144 — nothing to configure, ~1 KB per `setImage`.
- See [DESIGN.md](DESIGN.md) for the reasoning behind wrapping one plugin in the other.

## License

MIT — see [LICENSE](LICENSE).
