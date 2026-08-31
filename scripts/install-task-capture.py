#!/usr/bin/env python3
"""Install the MCP task capture helper as a per-user macOS LaunchAgent."""

from __future__ import annotations

import argparse
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path


LABEL = "org.pke.mcp-task-capture"


def main() -> None:
    parser = argparse.ArgumentParser(description="Install MCP Log Tarefas V2 capture")
    parser.add_argument("--owner", required=True)
    args = parser.parse_args()
    source_capture = Path(__file__).with_name("pke-task-capture.py").resolve()
    support_dir = Path.home() / "Library" / "Application Support" / "PKE Task Log"
    support_dir.mkdir(parents=True, exist_ok=True)
    capture = support_dir / "pke-task-capture.py"
    shutil.copy2(source_capture, capture)
    capture.chmod(0o700)
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
    print(f"Log Tarefas V2 ativo. Assistente: {capture}")
    print(f"Rascunhos: {output}")


if __name__ == "__main__":
    main()
