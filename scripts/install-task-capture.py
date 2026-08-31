#!/usr/bin/env python3
"""Install the MCP task capture helper as a per-user macOS LaunchAgent."""

from __future__ import annotations

import argparse
import os
import plistlib
import subprocess
import sys
from pathlib import Path


LABEL = "org.pke.mcp-task-capture"


def main() -> None:
    parser = argparse.ArgumentParser(description="Install MCP Log Tarefas V2 capture")
    parser.add_argument("--owner", required=True)
    args = parser.parse_args()
    capture = Path(__file__).with_name("pke-task-capture.py").resolve()
    output = Path.home() / "Downloads" / "pke-task-drafts.json"
    logs = Path.home() / "Library" / "Logs" / "PKE"
    launch_agents = Path.home() / "Library" / "LaunchAgents"
    plist_path = launch_agents / f"{LABEL}.plist"
    logs.mkdir(parents=True, exist_ok=True)
    launch_agents.mkdir(parents=True, exist_ok=True)
    payload = {
        "Label": LABEL,
        "ProgramArguments": [sys.executable, str(capture), "--owner", args.owner.strip(), "--output", str(output)],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ProcessType": "Background",
        "StandardOutPath": str(logs / "task-capture.log"),
        "StandardErrorPath": str(logs / "task-capture-error.log"),
    }
    with plist_path.open("wb") as handle:
        plistlib.dump(payload, handle)
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", domain, str(plist_path)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["launchctl", "bootstrap", domain, str(plist_path)], check=True)
    print(f"Log Tarefas V2 ativo. Rascunhos: {output}")


if __name__ == "__main__":
    main()
