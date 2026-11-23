"""Tests for the code gate and the session clock.

Run with:  python -m pytest -q
They use a stand-in for the phone call and the backend, so no LiveKit
account, model or network is needed.
"""

import asyncio
import os

os.environ.setdefault("COACH_BACKEND_URL", "http://localhost:1")
os.environ.setdefault("COACH_AGENT_SECRET", "test")

import agent  # noqa: E402
from coach_backend import BackendError, Member, Verified, clean_code  # noqa: E402


class FakeBackend:
    def __init__(self, good="304550", seconds=1200, down=False):
        self.good, self.seconds, self.down = good, seconds, down
        self.checked, self.ended = [], []

    async def verify(self, raw):
        if self.down:
            raise BackendError("down")
        code = clean_code(raw)
        self.checked.append(code)
        if code != self.good:
            return None
        return Verified(7, code, self.seconds, 20, False, Member(first_name="Kay"))

    async def end(self, session_id):
        self.ended.append(session_id)
        return True


class FakeCtx:
    def __init__(self):
        self.deleted = 0

    def delete_room(self):
        self.deleted += 1


class FakeSession:
    def __init__(self, backend):
        self.userdata = agent.Call(ctx=FakeCtx(), backend=backend)
        self.said, self.prompts, self.interrupts = [], [], 0

    async def _done(self):
        return None

    def say(self, text, **kw):
        self.said.append(text)
        return self._done()

    def generate_reply(self, *, instructions, **kw):
        self.prompts.append(instructions)

    def interrupt(self):
        self.interrupts += 1


def run(coro):
    return asyncio.run(coro)


def test_clean_code_keeps_digits_only():
    assert clean_code("3 0 4-5 5 0") == "304550"
    assert clean_code(None) == ""


def test_right_code_starts_the_session_once():
    async def go():
        s = FakeSession(FakeBackend())
        assert await agent.accept_code(s, "304 550") == "ok"
        assert s.userdata.verified.session_id == 7
        # A second check (say, keyed in as well as spoken) does not ask the backend again.
        assert await agent.accept_code(s, "000000") == "ok"
        assert s.userdata.backend.checked == ["304550"]
        for t in list(s.userdata.tasks):
            t.cancel()

    run(go())


def test_three_wrong_codes_lock_the_call():
    async def go():
        s = FakeSession(FakeBackend())
        assert await agent.accept_code(s, "111111") == "bad"
        assert await agent.accept_code(s, "222222") == "bad"
        assert await agent.accept_code(s, "333333") == "locked"
        # Even the right code is refused after that, and the backend isn't asked.
        assert await agent.accept_code(s, "304550") == "locked"
        assert s.userdata.verified is None
        assert len(s.userdata.backend.checked) == 3

    run(go())


def test_backend_trouble_does_not_cost_the_caller_a_try():
    async def go():
        s = FakeSession(FakeBackend(down=True))
        assert await agent.accept_code(s, "304550") == "error"
        assert s.userdata.attempts == 0

    run(go())


def test_a_session_with_no_time_left_is_refused():
    async def go():
        s = FakeSession(FakeBackend(seconds=0))
        assert await agent.accept_code(s, "304550") == "bad"

    run(go())


def test_clock_warns_then_ends_the_call_and_closes_the_session(monkeypatch):
    monkeypatch.setattr(agent, "WARN_SECONDS", 0.05)

    async def go():
        backend = FakeBackend()
        s = FakeSession(backend)
        v = Verified(7, "304550", 0.2, 20, False)
        await agent.run_clock(s, v)
        assert len(s.prompts) == 1 and "two minutes" in s.prompts[0]
        assert backend.ended == [7]
        assert s.said == [agent.TIME_UP_GOODBYE]
        assert s.userdata.ctx.deleted == 1

    run(go())


def test_hanging_up_early_leaves_the_session_open():
    async def go():
        backend = FakeBackend()
        s = FakeSession(backend)
        task = asyncio.create_task(agent.run_clock(s, Verified(7, "304550", 60, 20, False)))
        await asyncio.sleep(0.05)
        task.cancel()  # what the shutdown callback does when the caller leaves
        await asyncio.gather(task, return_exceptions=True)
        assert backend.ended == [] and s.said == []

    run(go())


def test_no_code_in_time_ends_the_call(monkeypatch):
    monkeypatch.setattr(agent, "GATE_SECONDS", 0.05)

    async def go():
        s = FakeSession(FakeBackend())
        await agent.gate_timeout(s)
        assert s.said == [agent.NO_CODE_GOODBYE] and s.userdata.ctx.deleted == 1

    run(go())
