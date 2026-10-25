"""Genova Control Board — Hermes plugin entry point.

Two tools, nothing else:

- ``streamdeck_board_status``  → what is installed, whether Stream Deck runs, and whether
  every gateway endpoint the board relies on answers on THIS machine.
- ``streamdeck_board_install`` → copy the bundled board where Stream Deck looks, back up
  whatever was there, optionally restart the app, and report what happened.

Design rule: the plugin never guesses. Anything it cannot verify is reported as unknown
rather than as a success.
"""

from __future__ import annotations

import logging

from . import board as _board

logger = logging.getLogger(__name__)

__version__ = "0.1.0"

_STATUS_SCHEMA = {
    "name": "streamdeck_board_status",
    "description": (
        "Report the state of the Genova Control Board: is the Stream Deck plugin installed, "
        "which version, is the Stream Deck app running, and does every Hermes gateway endpoint "
        "the board needs answer on this machine."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "gateway_url": {
                "type": "string",
                "description": "Hermes dashboard URL to probe. Defaults to http://localhost:9119.",
            },
        },
        "required": [],
    },
}

_INSTALL_SCHEMA = {
    "name": "streamdeck_board_install",
    "description": (
        "Install or update the Genova Control Board in the Stream Deck application: copies the "
        "bundled plugin into Stream Deck's plugins folder, backs up an existing copy, and "
        "restarts Stream Deck so the board is loaded."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "target_dir": {
                "type": "string",
                "description": (
                    "Stream Deck plugins directory. Leave empty to auto-detect "
                    "(Windows %APPDATA%, WSL /mnt/c, macOS Application Support)."
                ),
            },
            "restart": {
                "type": "boolean",
                "description": "Restart Stream Deck after copying, so the new board is loaded. Default true.",
            },
        },
        "required": [],
    },
}


def _status(gateway_url: str = _board.DEFAULT_GATEWAY, **_: object) -> str:
    report = _board.status(gateway_url=gateway_url or _board.DEFAULT_GATEWAY)
    return f"{_board.summarise(report)}\n\n{report}"


def _install(target_dir: str = "", restart: bool = True, **_: object) -> str:
    report = _board.install(target_dir=target_dir or None, restart=bool(restart))
    if not report.get("ok"):
        return f"Installation impossible : {report.get('error')}"

    deck = report.get("stream_deck") or {}
    deck_text = (
        f"Stream Deck redémarré (PID {deck.get('pid')})."
        if deck.get("restarted")
        else f"Stream Deck n'a pas été redémarré : {deck.get('reason', 'non demandé')}."
    )
    backup = f" Sauvegarde de la version précédente : {report['backup']}." if report.get("backup") else ""
    return (
        f"Board {report.get('version')} installé dans {report.get('target')} "
        f"({report.get('files')} fichiers).{backup} {deck_text}"
    )


def register(ctx) -> None:
    """Register the plugin's tools with Hermes."""
    ctx.register_tool(
        name="streamdeck_board_status",
        toolset="genova-control-board",
        schema=_STATUS_SCHEMA,
        handler=_status,
        description="État du Genova Control Board (plugin Stream Deck) et du gateway Hermes.",
        emoji="🎛️",
    )
    ctx.register_tool(
        name="streamdeck_board_install",
        toolset="genova-control-board",
        schema=_INSTALL_SCHEMA,
        handler=_install,
        description="Installe ou met à jour le Genova Control Board dans Stream Deck.",
        emoji="🎛️",
    )
    logger.info("genova-control-board %s : 2 outils enregistrés", __version__)
