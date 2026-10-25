"""Genova Control Board — a Hermes plugin that carries a Stream Deck plugin.

The Stream Deck board lives in ``assets/`` exactly as Stream Deck expects it. This
plugin's job is to put it where Stream Deck looks, keep it in sync, and tell the
truth about what is actually installed and reachable.

Everything here is stdlib-only and side-effect free until an install is asked for.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

PLUGIN_UUID = "com.genova.control-board"
APP_NAME = "Genova Control Board"
DEFAULT_GATEWAY = "http://localhost:9119"

PLUGIN_DIR = Path(__file__).resolve().parent
ASSETS = PLUGIN_DIR / "assets" / f"{PLUGIN_UUID}.sdPlugin"

# Endpoints the board actually calls. Reporting whether each answers turns
# "works on any Hermes" from a promise into a measurement.
PROBED_ENDPOINTS = [
    ("/api/health", "état du gateway", False),
    ("/api/status", "runtime du gateway", False),
    ("/api/model/info", "modèle actif", False),
    ("/api/system/stats", "métriques machine", True),
    ("/api/sessions/stats", "compteurs de sessions", True),
    ("/api/cron/jobs", "tâches planifiées", True),
    ("/api/profiles/active", "profil actif", True),
]


# ── Environment ────────────────────────────────────────────


def is_wsl() -> bool:
    try:
        return "microsoft" in Path("/proc/version").read_text(encoding="utf-8", errors="ignore").lower()
    except OSError:
        return False


def is_windows() -> bool:
    return os.name == "nt"


def is_macos() -> bool:
    return sys.platform == "darwin"


def _windows_users() -> List[Path]:
    """Windows user profiles reachable from WSL, most likely first."""
    root = Path("/mnt/c/Users")
    if not root.is_dir():
        return []
    profiles = [p for p in root.iterdir() if (p / "AppData").is_dir()]
    profiles.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return profiles


def streamdeck_plugins_dir() -> Optional[Path]:
    """Where Stream Deck keeps its plugins, or None when there is no Stream Deck here."""
    if is_windows():
        appdata = os.environ.get("APPDATA")
        if appdata:
            candidate = Path(appdata) / "Elgato" / "StreamDeck" / "Plugins"
            if candidate.is_dir():
                return candidate
        return None

    if is_macos():
        candidate = Path.home() / "Library" / "Application Support" / "com.elgato.StreamDeck" / "Plugins"
        return candidate if candidate.is_dir() else None

    if is_wsl():
        for profile in _windows_users():
            candidate = profile / "AppData" / "Roaming" / "Elgato" / "StreamDeck" / "Plugins"
            if candidate.is_dir():
                return candidate
        return None

    return None


def _windows_path(path: Path) -> str:
    """`/mnt/c/Program Files/...` → `C:\\Program Files\\...` for Windows-side tools.

    PowerShell and `Start-Process` cannot open a `/mnt/...` path: they see it as a
    literal directory name and fail with "file not found".
    """
    text = str(path)
    if text.startswith("/mnt/") and len(text) > 6:
        drive = text[5].upper()
        return f"{drive}:" + text[6:].replace("/", "\\")
    return text.replace("/", "\\")


def streamdeck_exe() -> Optional[Path]:
    candidates = [
        Path("/mnt/c/Program Files/Elgato/StreamDeck/StreamDeck.exe"),
        Path("C:/Program Files/Elgato/StreamDeck/StreamDeck.exe"),
        Path("/Applications/Elgato Stream Deck.app"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


# ── Versions ───────────────────────────────────────────────


def _manifest_version(sd_plugin: Path) -> Optional[str]:
    try:
        return str(json.loads((sd_plugin / "manifest.json").read_text(encoding="utf-8")).get("Version"))
    except (OSError, ValueError):
        return None


def bundled() -> Dict[str, Any]:
    return {
        "path": str(ASSETS),
        "version": _manifest_version(ASSETS),
        "complete": (ASSETS / "manifest.json").is_file() and (ASSETS / "bin" / "plugin.js").is_file(),
    }


def installed() -> Dict[str, Any]:
    plugins_dir = streamdeck_plugins_dir()
    if plugins_dir is None:
        return {"found": False, "reason": "aucun dossier Stream Deck détecté sur cette machine"}
    target = plugins_dir / f"{PLUGIN_UUID}.sdPlugin"
    return {
        "found": target.is_dir(),
        "path": str(target),
        "version": _manifest_version(target) if target.is_dir() else None,
    }


# ── Stream Deck process ────────────────────────────────────


def _run(command: List[str], timeout: int = 25) -> subprocess.CompletedProcess:
    """Run a command and decode its output as text.

    Windows tools reached from WSL speak UTF-16LE (`tasklist.exe`, `wsl.exe`), so the
    raw bytes are stripped of NULs and decoded leniently instead of trusting the locale.
    """
    proc = subprocess.run(command, capture_output=True, timeout=timeout)
    stdout = (proc.stdout or b"").replace(b"\x00", b"").decode("utf-8", errors="replace")
    stderr = (proc.stderr or b"").replace(b"\x00", b"").decode("utf-8", errors="replace")
    return subprocess.CompletedProcess(proc.args, proc.returncode, stdout, stderr)


def streamdeck_running() -> Optional[str]:
    """PID of StreamDeck.exe when it runs, else None. Unknown → None too."""
    try:
        if is_windows():
            out = _run(["tasklist", "/FI", "IMAGENAME eq StreamDeck.exe", "/FO", "CSV", "/NH"]).stdout
        elif is_wsl():
            out = _run(["/mnt/c/Windows/System32/tasklist.exe", "/FI", "IMAGENAME eq StreamDeck.exe", "/FO", "CSV", "/NH"]).stdout
        elif is_macos():
            out = _run(["pgrep", "-f", "Stream Deck"]).stdout
            return out.strip().splitlines()[0] if out.strip() else None
        else:
            return None
    except (OSError, subprocess.SubprocessError):
        return None
    for line in out.splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) >= 2 and parts[0].lower() == "streamdeck.exe":
            return parts[1]
    return None


def restart_streamdeck() -> Dict[str, Any]:
    """Stop then start the Stream Deck app so it reloads its plugins."""
    exe = streamdeck_exe()
    if exe is None:
        return {"restarted": False, "reason": "Stream Deck introuvable"}

    try:
        if is_windows():
            _run(["taskkill", "/IM", "StreamDeck.exe", "/F"])
            time.sleep(3)
            subprocess.Popen([str(exe)], close_fds=True)
        elif is_wsl():
            _run(["/mnt/c/WINDOWS/system32/taskkill.exe", "/IM", "StreamDeck.exe", "/F"])
            time.sleep(3)
            _run([
                "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
                "-NoProfile", "-Command", f"Start-Process '{_windows_path(exe)}'",
            ])
        elif is_macos():
            _run(["osascript", "-e", 'quit app "Elgato Stream Deck"'])
            time.sleep(3)
            _run(["open", "-a", "Elgato Stream Deck"])
        else:
            return {"restarted": False, "reason": "système non pris en charge"}
    except (OSError, subprocess.SubprocessError) as err:
        return {"restarted": False, "reason": str(err)}

    # Give the app time to boot and load plugins before we say it worked.
    for _ in range(20):
        time.sleep(1)
        pid = streamdeck_running()
        if pid:
            return {"restarted": True, "pid": pid}
    return {"restarted": False, "reason": "Stream Deck n'a pas redémarré"}


# ── Gateway probe ──────────────────────────────────────────


def _http(url: str, headers: Dict[str, str], timeout: float = 4.0) -> Dict[str, Any]:
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return {"ok": True, "status": response.status}
    except urllib.error.HTTPError as err:
        return {"ok": False, "status": err.code}
    except (urllib.error.URLError, OSError) as err:
        return {"ok": False, "status": 0, "error": str(getattr(err, "reason", err))}


def session_token(base_url: str) -> Optional[str]:
    """Same discovery the board does: the token the dashboard injects into its HTML."""
    try:
        with urllib.request.urlopen(f"{base_url}/", timeout=4) as response:
            html = response.read().decode("utf-8", errors="ignore")
    except (urllib.error.URLError, OSError):
        return None
    marker = '__HERMES_SESSION_TOKEN__="'
    start = html.find(marker)
    if start == -1:
        return None
    start += len(marker)
    end = html.find('"', start)
    return html[start:end] if end != -1 else None


def probe_gateway(base_url: str = DEFAULT_GATEWAY) -> Dict[str, Any]:
    health = _http(f"{base_url}/api/health", {"accept": "application/json"})
    if not health["ok"]:
        return {
            "reachable": False,
            "url": base_url,
            "error": health.get("error") or f"HTTP {health['status']}",
            "endpoints": [],
        }

    token = session_token(base_url)
    headers = {"accept": "application/json"}
    if token:
        headers["X-Hermes-Session-Token"] = token

    endpoints = []
    for path, label, needs_token in PROBED_ENDPOINTS:
        result = _http(f"{base_url}{path}", headers)
        endpoints.append({
            "path": path,
            "label": label,
            "needs_token": needs_token,
            "ok": result["ok"],
            "status": result["status"],
        })

    return {
        "reachable": True,
        "url": base_url,
        "token_found": bool(token),
        "endpoints": endpoints,
        "missing": [e["path"] for e in endpoints if not e["ok"] and not (e["needs_token"] and not token)],
    }


# ── Install ────────────────────────────────────────────────


def _copy_tree(source: Path, target: Path) -> int:
    copied = 0
    for item in sorted(source.rglob("*")):
        if not item.is_file():
            continue
        destination = target / item.relative_to(source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, destination)
        copied += 1
    return copied


def install(target_dir: Optional[str] = None, restart: bool = True) -> Dict[str, Any]:
    """Copy the bundled board into Stream Deck's plugins folder.

    Never deletes anything it did not put there: an existing board folder is
    copied aside into ``<StreamDeck>/Backups/`` before being overwritten, and a
    folder with the same name but a foreign manifest is left untouched.
    """
    report: Dict[str, Any] = {"ok": False, "uuid": PLUGIN_UUID}

    bundle = bundled()
    if not bundle["complete"]:
        report["error"] = f"paquet incomplet dans le dépôt : {bundle['path']}"
        return report

    if target_dir:
        plugins_dir = Path(target_dir).expanduser()
    else:
        plugins_dir = streamdeck_plugins_dir()
    if plugins_dir is None:
        report["error"] = (
            "aucun dossier de plugins Stream Deck trouvé — préciser target_dir, "
            "ou installer Stream Deck sur cette machine"
        )
        return report
    if not plugins_dir.is_dir():
        report["error"] = f"dossier inexistant : {plugins_dir}"
        return report

    destination = plugins_dir / f"{PLUGIN_UUID}.sdPlugin"
    report["target"] = str(destination)

    if destination.is_dir():
        existing_uuid = None
        try:
            existing_uuid = json.loads((destination / "manifest.json").read_text(encoding="utf-8")).get("UUID")
        except (OSError, ValueError):
            existing_uuid = None
        if existing_uuid and existing_uuid != PLUGIN_UUID:
            report["error"] = f"un autre plugin occupe ce dossier ({existing_uuid}) — rien n'a été touché"
            return report

        backup_root = plugins_dir.parent / "Backups" / "genova-control-board"
        backup_root.mkdir(parents=True, exist_ok=True)
        backup = backup_root / time.strftime("%Y%m%d_%H%M%S")
        shutil.copytree(destination, backup)
        report["backup"] = str(backup)

    copied = _copy_tree(ASSETS, destination)
    report["files"] = copied
    report["version"] = _manifest_version(destination)

    if restart:
        report["stream_deck"] = restart_streamdeck()

    report["ok"] = True
    return report


# ── Status ─────────────────────────────────────────────────


def status(gateway_url: str = DEFAULT_GATEWAY) -> Dict[str, Any]:
    bundle = bundled()
    current = installed()
    same = bool(bundle["version"] and current.get("version") and bundle["version"] == current["version"])

    return {
        "board": {
            "bundled_version": bundle["version"],
            "bundled_complete": bundle["complete"],
            "installed": current,
            "up_to_date": same,
        },
        "system": {
            "environment": "wsl" if is_wsl() else platform.system().lower(),
            "stream_deck_running_pid": streamdeck_running(),
            "stream_deck_exe": str(streamdeck_exe()) if streamdeck_exe() else None,
            "plugins_dir": str(streamdeck_plugins_dir()) if streamdeck_plugins_dir() else None,
        },
        "gateway": probe_gateway(gateway_url),
    }


def summarise(report: Dict[str, Any]) -> str:
    """One-paragraph, human-readable rendition of a status/install report."""
    board = report["board"]
    system = report["system"]
    gateway = report["gateway"]

    if not board["installed"]["found"]:
        installed_text = "le board n'est pas installé."
    elif board["up_to_date"]:
        installed_text = f"le board {board['installed']['version']} est installé et à jour."
    else:
        installed_text = (
            f"le board {board['installed'].get('version')} est installé, "
            f"mais le paquet embarque la version {board['bundled_version']}."
        )

    deck = "Stream Deck tourne" if system["stream_deck_running_pid"] else "Stream Deck ne tourne pas"

    if gateway["reachable"]:
        missing = gateway["missing"]
        gateway_text = f"le gateway répond sur {gateway['url']}"
        gateway_text += f", sauf {', '.join(missing)}" if missing else ", tous les points d'entrée du board répondent"
        if not gateway.get("token_found"):
            gateway_text += " ; aucun token de session trouvé (dashboard derrière un portail ?)"
    else:
        gateway_text = f"le gateway ne répond pas sur {gateway['url']} ({gateway.get('error')})"

    return f"{installed_text} {deck}. Côté gateway, {gateway_text}."
