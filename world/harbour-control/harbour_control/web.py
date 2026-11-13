"""Incident and approval pages, plus the MCP endpoint, in one app on :8090.

Pages need an approver login. /mcp and /api need the bearer token the AI SRE holds. Every decision made
here is recorded against the signed-in approver.
"""

import hashlib
import hmac
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, Form, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from harbour_control.approvals import InvalidTransition, Remediations
from harbour_control.config import Settings
from harbour_control.policy import ACTIONS, BLAST_RADIUS, PolicyError
from harbour_control.store import Store
from harbour_control.tools import build_mcp

COOKIE = "sre_session"
SESSION_S = 12 * 3600
templates = Jinja2Templates(directory=Path(__file__).parent / "templates")

# One place turns machine names into the words a human reads. Anything not listed here reads as a
# sentence anyway, so a new rule or event kind never shows up as snake_case on the page.
PHRASES = {
    "rollback_release": "Roll back release",
    "restart_service": "Restart service",
    "error_rate": "Error rate above the bound",
    "rollback_config": "Roll back config",
    "manual_page": "Paged by hand",
    "stuck_requests": "Requests that never finished",
}


def phrase(name: str) -> str:
    return PHRASES.get(name) or name.replace("_", " ").capitalize()


templates.env.globals["phrase"] = phrase


def sign(secret: str, email: str, expires: int) -> str:
    mac = hmac.new(secret.encode(), f"{email}|{expires}".encode(), hashlib.sha256).hexdigest()
    return f"{email}|{expires}|{mac}"


def verify(secret: str, cookie: str | None) -> str | None:
    try:
        email, expires, _ = (cookie or "").split("|")
        valid = hmac.compare_digest(sign(secret, email, int(expires)), cookie or "")
        return email if valid and int(expires) > time.time() else None
    except ValueError:
        return None


def create_app(
    *, settings: Settings, remediations: Remediations, store: Store, telemetry=None, lifespan=None
):
    mcp = build_mcp(
        telemetry=telemetry,
        remediations=remediations,
        token=settings.mcp_token,
        public_url=settings.public_url,
    )
    mcp_app = mcp.http_app(path="/mcp")
    app = FastAPI(
        title="harbour-control",
        lifespan=lifespan or mcp_app.lifespan,
        docs_url=None,
        redoc_url=None,
    )
    app.state.mcp_app = mcp_app

    def user(request: Request) -> str | None:
        return verify(settings.session_secret, request.cookies.get(COOKIE))

    def to_login(request: Request) -> RedirectResponse:
        return RedirectResponse(f"/login?next={quote(request.url.path)}", status_code=303)

    def back(path: str) -> RedirectResponse:
        return RedirectResponse(path, status_code=303)

    @app.get("/healthz")
    def healthz():
        store.events(kind="healthz")
        return {"ok": True}

    @app.get("/login", response_class=HTMLResponse)
    def login_page(request: Request, next: str = "/"):
        return templates.TemplateResponse(request, "login.html", {"next": next, "error": None})

    @app.post("/login")
    def login(request: Request, email: str = Form(), password: str = Form(), next: str = Form("/")):
        # Both comparisons always run, so the response time does not reveal which one failed.
        email_ok = hmac.compare_digest(
            email.lower().encode(), settings.approver_email.lower().encode()
        )
        password_ok = hmac.compare_digest(password.encode(), settings.approver_password.encode())
        ok = email_ok & password_ok
        if not ok:
            ctx = {"next": next, "error": "That email and password do not match."}
            return templates.TemplateResponse(request, "login.html", ctx, status_code=401)
        target = next if next.startswith("/") and not next.startswith("//") else "/"
        response = back(target)
        secure = settings.public_url.startswith("https://")
        response.set_cookie(
            COOKIE, sign(settings.session_secret, email.lower(), int(time.time()) + SESSION_S),
            httponly=True, samesite="lax", secure=secure, max_age=SESSION_S,
        )  # fmt: skip
        return response

    @app.get("/", response_class=HTMLResponse)
    def incidents(request: Request):
        if not (who := user(request)):
            return to_login(request)
        return templates.TemplateResponse(
            request, "incidents.html", {"who": who, "incidents": store.incidents()}
        )

    @app.get("/incidents/{incident_id}", response_class=HTMLResponse)
    def incident(request: Request, incident_id: str):
        if not (who := user(request)):
            return to_login(request)
        try:
            found = store.incident(incident_id)
        except KeyError:
            return HTMLResponse("No such incident", status_code=404)
        ctx = {
            "who": who,
            "incident": found,
            "actions": remediations.actions_for(incident_id),
            "timeline": store.events(incident_id=incident_id),
            "findings": remediations.findings_for(incident_id),
            "mcp_url": f"{settings.public_url}/mcp",
        }
        return templates.TemplateResponse(request, "incident.html", ctx)

    @app.get("/actions/{action_id}", response_class=HTMLResponse)
    def action(request: Request, action_id: str, error: str | None = None):
        if not (who := user(request)):
            return to_login(request)
        try:
            state = remediations.status(action_id)
        except KeyError:
            return HTMLResponse("No such remediation", status_code=404)
        ctx = {
            "who": who,
            "a": state,
            "incident": store.incident(state.incident_id),
            "blast_radius": BLAST_RADIUS[state.action],
            "actions": ACTIONS,
            "targets": sorted({t for targets in ACTIONS.values() for t in targets}),
            "error": error,
        }
        return templates.TemplateResponse(request, "action.html", ctx)

    def decide(request: Request, action_id: str, fn) -> RedirectResponse:
        if not (who := user(request)):
            return to_login(request)
        try:
            fn(who)
        except (InvalidTransition, PolicyError) as err:
            return back(f"/actions/{action_id}?error={quote(str(err))}")
        return back(f"/actions/{action_id}")

    @app.post("/actions/{action_id}/approve")
    def approve(request: Request, action_id: str):
        return decide(request, action_id, lambda who: remediations.approve(action_id, approver=who))

    @app.post("/actions/{action_id}/reject")
    def reject(request: Request, action_id: str, reason: str = Form("")):
        return decide(
            request,
            action_id,
            lambda who: remediations.reject(action_id, approver=who, reason=reason),
        )

    @app.post("/actions/{action_id}/edit")
    def edit(request: Request, action_id: str, action: str = Form(), target: str = Form()):
        # Each allowed parameter has exactly one allowed value, so the form only picks action and target.
        params = {k: next(iter(v)) for k, v in ACTIONS.get(action, {}).get(target, {}).items()}
        return decide(
            request,
            action_id,
            lambda who: remediations.edit(
                action_id, editor=who, action=action, target=target, params=params
            ),
        )

    @app.post("/api/incidents")
    def page(body: dict, authorization: str = Header("")):
        # A person or a noisy alert can page by hand; the incident it opens is like any other.
        if not hmac.compare_digest(authorization.encode(), f"Bearer {settings.mcp_token}".encode()):
            return JSONResponse({"error": "a bearer token is required"}, status_code=401)
        found = store.open_incident(
            rule="manual_page", service=str(body.get("service", "")), summary=str(body.get("summary", "")),
            opened_at=datetime.now(UTC), details={"paged_by": str(body.get("paged_by", "on-call"))},
        )  # fmt: skip
        return {"incident_id": found.id}

    @app.exception_handler(KeyError)
    def not_found(request: Request, exc: KeyError):
        return JSONResponse({"error": f"not found: {exc}"}, status_code=404)

    app.mount("/", mcp_app)
    return app
