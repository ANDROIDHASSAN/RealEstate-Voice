"""
CloseFlow multi-agent orchestrator (M9).

Config-driven crew: agents are data (crew_agents.json), the router decides the
path, live agents may consult an LLM (Groq/Gemini via REST), and the response
is always a STRUCTURED next-best-action that the Node API executes.
Compliance Guard runs before any outbound-type action is emitted.
"""
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="CloseFlow Agents", version="0.1.0")

CONFIG = json.loads((Path(__file__).parent / "crew_agents.json").read_text(encoding="utf-8"))
AGENTS = {a["key"]: a for a in CONFIG["agents"]}


def env_val(name: str) -> str:
    raw = os.getenv(name, "")
    cleaned = re.sub(r"\s+#.*$", "", raw).strip()
    return "" if cleaned.startswith("#") else cleaned


GROQ_KEY = env_val("GROQ_API_KEY")
GEMINI_KEY = env_val("GEMINI_API_KEY")


class Lead(BaseModel):
    model_config = {"extra": "allow"}
    status: str = "new"
    intent: str = "unknown"
    urgency: str = "unknown"
    locale: str = "en"
    score: int = 0
    phone: Optional[str] = None
    consent: dict[str, Any] = Field(default_factory=dict)


class OrchestrateRequest(BaseModel):
    lead: Lead
    history: list[dict[str, Any]] = Field(default_factory=list)
    transcript: list[dict[str, Any]] = Field(default_factory=list)
    goal: str = "Book a qualified appointment"


class NextBestAction(BaseModel):
    type: str
    params: dict[str, str] = Field(default_factory=dict)
    reasoning: str
    agentPath: list[str]


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "closeflow-agents", "agents": len(AGENTS), "llm": bool(GROQ_KEY or GEMINI_KEY)}


@app.get("/agents")
def list_agents() -> dict[str, Any]:
    return {"agents": CONFIG["agents"]}


async def llm_complete(prompt: str) -> Optional[str]:
    """Groq first (fast/free), Gemini fallback. None when no key or failure."""
    try:
        if GROQ_KEY:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {GROQ_KEY}"},
                    json={
                        "model": "llama-3.3-70b-versatile",
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 300,
                        "response_format": {"type": "json_object"},
                    },
                )
                if r.status_code == 200:
                    return r.json()["choices"][0]["message"]["content"]
        if GEMINI_KEY:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_KEY}",
                    json={
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {"maxOutputTokens": 300, "responseMimeType": "application/json"},
                    },
                )
                if r.status_code == 200:
                    return r.json()["candidates"][0]["content"]["parts"][0]["text"]
    except Exception:
        return None
    return None


def compliance_guard(lead: Lead, action_type: str) -> Optional[str]:
    """MANDATORY pre-outbound check (mirrors the API-side ComplianceGuard)."""
    if lead.status == "dnc":
        return "lead_dnc"
    consent = lead.consent or {}
    needs = {"call": "call", "sms": "sms", "whatsapp": "whatsapp", "email": "email"}
    if action_type in needs and not consent.get(needs[action_type], action_type == "email"):
        return f"no_{action_type}_consent"
    hour = datetime.now(timezone.utc).hour
    offsets = {"en": -5, "es": -5, "pt": -5, "ht": -5, "ar": 3}
    local_hour = (hour + offsets.get(lead.locale, -5)) % 24
    if action_type in ("call", "sms", "whatsapp") and not (8 <= local_hour < 21):
        if os.getenv("COMPLIANCE_IGNORE_QUIET_HOURS") != "1":
            return "quiet_hours"
    return None


def score_lead(lead: Lead) -> int:
    score = 20
    score += {"now": 35, "1-3mo": 25, "3-6mo": 10}.get(lead.urgency, 0)
    score += {"buyer": 15, "seller": 20, "investor": 15, "renter": 5}.get(lead.intent, 0)
    if lead.phone:
        score += 10
    score += {"qualified": 15, "appointment": 20, "contacted": 5}.get(lead.status, 0)
    return min(100, score)


def rule_route(lead: Lead, has_calls: bool, goal: str) -> NextBestAction:
    path = ["router", "compliance-guard", "lead-scorer", "next-best-action"]
    if lead.status == "new" and lead.phone:
        return NextBestAction(type="call", params={"agentKey": "speed-to-lead"},
                              reasoning="New lead with a phone — fastest path to contact is the speed-to-lead call.",
                              agentPath=path)
    if lead.status == "contacted" and not has_calls and lead.phone:
        key = {"seller": "seller-qualifier", "renter": "renter-qualifier", "investor": "investor-screener"}.get(lead.intent, "buyer-qualifier")
        return NextBestAction(type="call", params={"agentKey": key},
                              reasoning=f"Contacted but never voice-qualified — run the {key}.",
                              agentPath=path + ["buyer-strategist" if lead.intent != "seller" else "seller-strategist"])
    if lead.status == "qualified":
        return NextBestAction(type="book", params={},
                              reasoning=f"Qualified — book the consult (goal: {goal}).",
                              agentPath=path + ["scheduler"])
    return NextBestAction(type="enrollSequence", params={},
                          reasoning="No immediate action — nurture via follow-up sequence.",
                          agentPath=path + ["followup-strategist"])


@app.post("/orchestrate", response_model=NextBestAction)
async def orchestrate(req: OrchestrateRequest) -> NextBestAction:
    lead = req.lead
    has_calls = len(req.transcript) > 0
    action = rule_route(lead, has_calls, req.goal)
    action.params["score"] = str(score_lead(lead))

    # Live LLM refinement of the next-best-action when a key is present.
    llm_raw = await llm_complete(
        "You are the Next-Best-Action agent for a real-estate AI team. "
        f"Lead: {lead.model_dump()}. Recent transcript turns: {req.transcript[-6:]}. "
        f"Goal: {req.goal}. The rule-based suggestion is '{action.type}'. "
        'Reply JSON: {"type": "call|sms|whatsapp|email|enrollSequence|book|wait", "reasoning": "..."} '
        "Prefer the rule suggestion unless the transcript clearly contradicts it."
    )
    if llm_raw:
        try:
            parsed = json.loads(llm_raw)
            if parsed.get("type") in {"call", "sms", "whatsapp", "email", "enrollSequence", "book", "wait"}:
                action.type = parsed["type"]
                action.reasoning = f"[CrewAI/LLM] {parsed.get('reasoning', action.reasoning)}"
        except (json.JSONDecodeError, AttributeError):
            pass

    # Compliance Guard is final: block turns any outbound into 'wait'.
    if action.type in ("call", "sms", "whatsapp", "email"):
        blocked = compliance_guard(lead, action.type)
        if blocked:
            return NextBestAction(
                type="wait", params={"blockedReason": blocked},
                reasoning=f"Compliance Guard blocked '{action.type}' ({blocked}); waiting instead.",
                agentPath=action.agentPath + ["compliance-guard"],
            )
    return action


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
