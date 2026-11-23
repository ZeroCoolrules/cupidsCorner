"""Talks to the Cupid's Corner backend on behalf of the voice agent.

The backend owns payment and session state. This module only checks a
caller's one-time code and closes a session when its time is used up.
It has no LiveKit imports so it can be tested on its own.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

import aiohttp

CODE_LENGTH = 6


def clean_code(raw: object) -> str:
    """Keep only the digits of whatever the caller said or keyed in."""
    return re.sub(r"\D", "", str(raw or ""))


@dataclass
class Member:
    first_name: str = ""
    age: int | None = None
    gender: str = ""
    looking_for: str = ""
    city: str = ""
    bio: str = ""


@dataclass
class Verified:
    """A code the backend accepted."""

    session_id: int
    code: str
    seconds_left: int
    minutes: int
    resumed: bool
    member: Member = field(default_factory=Member)


class BackendError(Exception):
    """The backend could not be reached or refused the agent itself.

    This is different from a wrong code: the caller did nothing wrong, so
    it must not count against their attempts.
    """


class CoachBackend:
    def __init__(self, base_url: str | None = None, secret: str | None = None, timeout: float = 8.0):
        self.base_url = (base_url or os.environ.get("COACH_BACKEND_URL", "")).rstrip("/")
        self.secret = secret or os.environ.get("COACH_AGENT_SECRET", "")
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        if not self.base_url:
            raise RuntimeError("COACH_BACKEND_URL is not set")
        if not self.secret:
            raise RuntimeError("COACH_AGENT_SECRET is not set")

    async def _post(self, path: str, body: dict) -> dict:
        url = f"{self.base_url}/api/v1/coach/agent/{path}"
        headers = {"authorization": f"Bearer {self.secret}"}
        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as http:
                async with http.post(url, json=body, headers=headers) as res:
                    if res.status != 200:
                        raise BackendError(f"backend answered {res.status} on {path}")
                    return await res.json()
        except (aiohttp.ClientError, TimeoutError, ValueError) as err:
            raise BackendError(f"backend unreachable on {path}: {err}") from err

    async def verify(self, raw_code: object) -> Verified | None:
        """Return the session for a valid code, or None for a wrong, used or expired one."""
        code = clean_code(raw_code)
        if len(code) != CODE_LENGTH:
            return None
        data = await self._post("verify", {"code": code})
        if not data.get("valid"):
            return None
        m = data.get("member") or {}
        return Verified(
            session_id=int(data["sessionId"]),
            code=code,
            seconds_left=max(0, int(data.get("secondsLeft", 0))),
            minutes=int(data.get("minutes", 0)),
            resumed=bool(data.get("resumed")),
            member=Member(
                first_name=str(m.get("firstName") or ""),
                age=m.get("age"),
                gender=str(m.get("gender") or ""),
                looking_for=str(m.get("lookingFor") or ""),
                city=str(m.get("city") or ""),
                bio=str(m.get("bio") or ""),
            ),
        )

    async def end(self, session_id: int) -> bool:
        """Close a session whose time is used up. Safe to call twice."""
        data = await self._post("end", {"sessionId": session_id})
        return bool(data.get("ended"))
