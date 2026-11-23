# Cupid voice coach (LiveKit agent)

This is the agent that answers the paid coach line. It will not coach anyone until they give a valid session code, and it holds every session to the time that was paid for.

## What a call looks like

1. The member pays on the Coach page and gets the number and a six-digit code.
2. They call. Cupid asks for the code. They can say it or key it in.
3. The agent checks the code with the backend (`POST /api/v1/coach/agent/verify`). The first valid check starts the clock on the backend.
4. Coaching runs. Cupid gives a two-minute warning, says goodbye when time is up, closes the session on the backend and hangs up.

Rules it enforces:

- Three wrong codes, or two and a half minutes without a valid one, ends the call.
- If the member hangs up early or the call drops, the session stays open. Calling back with the same code picks up the remaining time.
- If the backend can't be reached, the caller is asked to try again and it doesn't count as a wrong code.
- The coach only gets the member's first name, age, gender, who they're looking for, city and bio.

## Files

| File | What it is |
| --- | --- |
| `agent.py` | The agent: code gate, coaching session, session clock |
| `coach_prompt.md` | How Cupid coaches. Edit this to change the personality or advice style. If you already have a prompt from your own LiveKit agent, paste it here. |
| `coach_backend.py` | The two calls to the backend (check a code, close a session) |
| `test_agent.py` | Tests for the gate and the clock. `python -m pytest -q` |
| `.env.example` | Every setting, with comments |
| `Dockerfile` | For deploying to LiveKit Cloud or any container host |

## Settings

| Variable | Needed | What it is |
| --- | --- | --- |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Yes (set for you when deployed on LiveKit Cloud) | Your LiveKit project |
| `COACH_BACKEND_URL` | Yes | The backend, for example `https://cupids-corner.onrender.com` |
| `COACH_AGENT_SECRET` | Yes | Must be exactly the value of `COACH_AGENT_SECRET` on the backend (Render) |
| `COACH_AGENT_NAME` | No | Name the phone line dispatches to. Default `cupid-coach` |
| `COACH_STT_MODEL`, `COACH_LLM_MODEL`, `COACH_TTS_MODEL`, `COACH_TTS_VOICE` | No | Speech and language models, served through LiveKit Inference and billed to your LiveKit project, so no other provider keys are needed |

Never commit `.env`. It is in `.gitignore`.

## Set it up

You need a LiveKit Cloud project and the [LiveKit CLI](https://docs.livekit.io/home/cli/) (`lk`), signed in with `lk cloud auth`.

### 1. Run it on your computer first

```bash
cd voice-agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then fill in the values
python agent.py download-files
python agent.py dev
```

`dev` connects the agent to your LiveKit project and waits for calls.

### 2. Point the coach number at this agent

The agent has a name (`cupid-coach`), so it only answers calls that are sent to it by name. That is done with a dispatch rule in LiveKit's Telephony settings.

- If the number was bought inside LiveKit (Telephony, Phone numbers), add a dispatch rule for that number.
- If the number is from Twilio, Telnyx or another carrier, it also needs an inbound trunk in LiveKit and the carrier pointed at your LiveKit SIP address. LiveKit's Telephony docs walk through each carrier.

A dispatch rule that gives each caller their own room and sends them to this agent:

```json
{
  "dispatch_rule": {
    "name": "Cupid coach line",
    "rule": { "dispatchRuleIndividual": { "roomPrefix": "coach-" } },
    "roomConfig": { "agents": [{ "agentName": "cupid-coach" }] }
  }
}
```

Save it as `dispatch-rule.json` and run `lk sip dispatch create dispatch-rule.json`, or create the same rule in the LiveKit dashboard. If your number already sends calls to another agent, change that rule to `cupid-coach` instead of adding a second one.

### 3. Test with a real code

1. On the site, buy a coach session and note the code.
2. Call the number, give the code, and check Cupid greets you by name.
3. Hang up and call back with the same code. It should welcome you back with the time that is left.
4. Call and give a wrong code three times. It should end the call.

### 4. Deploy it so it runs all the time

From this folder, `lk agent create` builds the `Dockerfile` and runs the agent on LiveKit Cloud. Add `COACH_BACKEND_URL` and `COACH_AGENT_SECRET` as secrets when it asks. The `LIVEKIT_*` values are supplied by LiveKit Cloud. Any other container host works too: build the image and set all the variables from the table.

## Good to know

- Each call uses speech-to-text, a language model and text-to-speech for its whole length, billed by LiveKit. The session price in sparks (`COACH_SESSION_SPARKS` on the backend) should comfortably cover that.
- Anyone who has the number can reach the greeting, but they get at most two and a half minutes and no coaching without a paid code.
- The agent tells callers who mention being in danger or self-harm to contact emergency services or a crisis line. It is a coach, not a counsellor.
