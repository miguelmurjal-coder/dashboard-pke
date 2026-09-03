#!/usr/bin/env python3
"""Private macOS activity capture for MCP Log Tarefas V2.

The helper observes only the foreground application/window. It never records
keystrokes or page contents. Drafts remain in a local JSON file until imported
and confirmed in the MCP.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import signal
import subprocess
import time
import uuid
from dataclasses import asdict, dataclass, fields
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse


POLL_SECONDS = 10
MIN_SEGMENT_SECONDS = 30
IDLE_SECONDS = 180
MERGE_GAP_SECONDS = 180
MAX_SEGMENT_SECONDS = 15 * 60


@dataclass
class Segment:
    id: str
    date: str
    start: str
    end: str
    task: str
    category: str
    app: str
    notes: str
    owner: str
    confidence: float
    started_at: float
    ended_at: float


def run(command: list[str]) -> str:
    try:
        return subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def idle_seconds() -> float:
    output = run(["ioreg", "-c", "IOHIDSystem"])
    match = re.search(r'"HIDIdleTime"\s*=\s*(\d+)', output)
    return int(match.group(1)) / 1_000_000_000 if match else 0


def foreground_context() -> tuple[str, str, str]:
    script = r'''
tell application "System Events"
  set appName to name of first application process whose frontmost is true
  set windowName to ""
  try
    set windowName to name of front window of application process appName
  end try
end tell
set pageURL to ""
if appName is "Google Chrome" then
  try
    tell application "Google Chrome"
      set windowName to title of active tab of front window
      set pageURL to URL of active tab of front window
    end tell
  end try
else if appName is "Safari" then
  try
    tell application "Safari"
      set windowName to name of current tab of front window
      set pageURL to URL of current tab of front window
    end tell
  end try
end if
return appName & linefeed & windowName & linefeed & pageURL
'''
    parts = run(["osascript", "-e", script]).splitlines()
    return tuple((parts + ["", "", ""])[:3])


def active_calendar_event() -> str:
    script = r'''
set nowDate to current date
tell application "Calendar"
  repeat with cal in calendars
    try
      set matches to (every event of cal whose start date ≤ nowDate and end date ≥ nowDate)
      if (count of matches) > 0 then return summary of item 1 of matches
    end try
  end repeat
end tell
return ""
'''
    return run(["osascript", "-e", script])


def classify(app: str, title: str, url: str) -> tuple[str, str, float]:
    domain = urlparse(url).netloc.lower().removeprefix("www.") if url else ""
    haystack = f"{app} {title} {domain}".lower()
    if "youtube.com" in domain or "murjal98" in haystack:
        return "Pausa pessoal", "Pausa", 0.98
    if any(value in haystack for value in ("meet.google", "zoom", "teams meeting")):
        return title or "Reunião", "Reunião", 0.9
    if any(value in haystack for value in ("meta business", "ads manager", "facebook.com/ads")):
        return "Gestão de campanhas Meta Ads", "Marketing", 0.88
    if any(value in haystack for value in ("google ads", "ads.google.com")):
        return "Gestão de campanhas Google Ads", "Marketing", 0.88
    if app in ("Adobe Photoshop 2026", "Adobe Illustrator 2026", "Adobe Premiere Pro 2026", "Figma"):
        return title or "Design / criativos", "Design", 0.82
    if app in ("Microsoft Excel", "Numbers") or "docs.google.com/spreadsheets" in url:
        return title or "Análise e atualização de dados", "Marketing", 0.72
    if app in ("Codex", "Terminal", "Visual Studio Code"):
        return title or "Dashboard / sistemas", "Sistemas", 0.78
    if any(value in haystack for value in ("gmail", "mail", "outlook")):
        return "Email / comunicação", "Admin", 0.62
    return title or app or "Atividade por classificar", "Outro", 0.35


def time_label(timestamp: float, round_up: bool = False) -> str:
    minute = math.ceil(timestamp / 60) if round_up else math.floor(timestamp / 60)
    return datetime.fromtimestamp(minute * 60).strftime("%H:%M")


class Capture:
    def __init__(self, owner: str, output: Path):
        self.owner = owner
        self.output = output
        self.segments = self.load_existing_segments()
        self.current: Segment | None = None
        self.running = True

    def load_existing_segments(self) -> list[Segment]:
        if not self.output.exists():
            return []
        try:
            payload = json.loads(self.output.read_text(encoding="utf-8"))
            raw_entries = payload if isinstance(payload, list) else payload.get("entries", [])
            allowed = {field.name for field in fields(Segment)}
            loaded: list[Segment] = []
            seen: set[str] = set()
            for raw in raw_entries:
                if not isinstance(raw, dict) or not raw.get("id") or raw["id"] in seen:
                    continue
                values = {key: raw[key] for key in allowed if key in raw}
                values.setdefault("owner", self.owner)
                values.setdefault("confidence", 0.0)
                values.setdefault("started_at", 0.0)
                values.setdefault("ended_at", values["started_at"])
                try:
                    loaded.append(Segment(**values))
                    seen.add(raw["id"])
                except TypeError:
                    continue
            return loaded
        except (OSError, json.JSONDecodeError, AttributeError) as error:
            raise RuntimeError("Cannot read existing drafts; refusing to overwrite them") from error

    def close_current(self, ended_at: float) -> None:
        if not self.current:
            return
        self.current.ended_at = ended_at
        self.current.end = time_label(ended_at, round_up=True)
        duration = ended_at - self.current.started_at
        if duration >= MIN_SEGMENT_SECONDS:
            self.segments.append(self.current)
        self.current = None
        self.write()

    def observe(self) -> None:
        now = time.time()
        idle = idle_seconds()
        if idle >= IDLE_SECONDS:
            self.close_current(now - idle)
            return
        app, title, url = foreground_context()
        if not app:
            return
        task, category, confidence = classify(app, title, url)
        if category == "Reunião":
            calendar_title = active_calendar_event()
            if calendar_title:
                task = calendar_title
                confidence = 0.98
        key = (task, category, app)
        current_key = (self.current.task, self.current.category, self.current.app) if self.current else None
        if key == current_key and self.current.date == datetime.now().strftime("%Y-%m-%d") and now - self.current.started_at < MAX_SEGMENT_SECONDS:
            self.current.ended_at = now
            self.current.end = time_label(now, round_up=True)
            return
        self.close_current(now)
        self.current = Segment(
            id=f"capture-{uuid.uuid4().hex}",
            date=datetime.now().strftime("%Y-%m-%d"),
            start=time_label(now),
            end=time_label(now, round_up=True),
            task=task,
            category=category,
            app=app,
            notes=f"Sugestão automática · {app}",
            owner=self.owner,
            confidence=confidence,
            started_at=now,
            ended_at=now,
        )

    def write(self) -> None:
        self.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        entries = [asdict(item) for item in self.segments]
        # Export only closed segments: an imported ID must never grow afterwards.
        payload = {
            "version": 2,
            "generatedAt": datetime.now().isoformat(timespec="seconds"),
            "owner": self.owner,
            "privacy": "local-draft",
            "entries": entries,
        }
        temporary = self.output.with_suffix(f"{self.output.suffix}.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.chmod(0o600)
        temporary.replace(self.output)

    def stop(self, *_args) -> None:
        self.running = False

    def loop(self) -> None:
        signal.signal(signal.SIGINT, self.stop)
        signal.signal(signal.SIGTERM, self.stop)
        while self.running:
            self.observe()
            self.write()
            time.sleep(POLL_SECONDS)
        self.close_current(time.time())


def main() -> None:
    parser = argparse.ArgumentParser(description="MCP Log Tarefas V2 activity capture")
    parser.add_argument("--owner", required=True, help="Name shown on confirmed entries")
    parser.add_argument("--output", type=Path, default=Path.home() / "PKE Task Log" / "pke-task-drafts.json")
    args = parser.parse_args()
    Capture(args.owner.strip(), args.output.expanduser()).loop()


if __name__ == "__main__":
    main()
