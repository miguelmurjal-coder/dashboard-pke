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
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    plist_path = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
    previous_output = Path.home() / "PKE Task Log" / "pke-task-drafts.json"
    if plist_path.exists():
        with plist_path.open("rb") as handle:
            previous_args = plistlib.load(handle).get("ProgramArguments", [])
        if "--output" in previous_args:
            previous_output = Path(previous_args[previous_args.index("--output") + 1])
    if not previous_output.exists():
        previous_output = Path.home() / "Downloads" / "pke-task-drafts.json"
    output = args.output.expanduser().resolve() if args.output else (
        previous_output if previous_output.parent.name != "Downloads" else Path.home() / "PKE Task Log" / "pke-task-drafts.json"
    )
    if output != previous_output and output.exists() and (not previous_output.exists() or output.read_bytes() != previous_output.read_bytes()):
        raise RuntimeError("Destination already exists; refusing to overwrite drafts")
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", domain, str(plist_path)], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    source_capture = Path(__file__).with_name("pke-task-capture.py").resolve()
    support_dir = Path.home() / "Library" / "Application Support" / "PKE Task Log"
    support_dir.mkdir(parents=True, exist_ok=True)
    capture = support_dir / "pke-task-capture.py"
    shutil.copy2(source_capture, capture)
    capture.chmod(0o700)
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not output.exists() and previous_output.exists():
        shutil.copy2(previous_output, output)
        output.chmod(0o600)
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
    subprocess.run(["launchctl", "bootstrap", domain, str(plist_path)], check=True)
    print(f"Log Tarefas V2 ativo. Assistente: {capture}")
    print(f"Rascunhos: {output}")


if __name__ == "__main__":
    main()
