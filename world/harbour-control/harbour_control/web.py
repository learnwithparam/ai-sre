"""Incident and approval pages, plus the MCP endpoint, in one app on :8090.

Pages need an approver login. /mcp and /api need the bearer token the AI SRE holds. Every decision
made here is recorded against the signed-in approver.
"""

import hashlib
import hmac
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, Form, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from harbour_control.approvals import InvalidTransitionError, PlannedAction, Remediations
from harbour_control.config import Settings
from harbour_control.policy import ACTIONS, BLAST_RADIUS, PolicyError
from harbour_control.store import IncidentReport
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
    message = f"{email}|{expires}".encode()
    signature = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return f"{email}|{expires}|{signature}"


def verify(secret: str, cookie: str | None) -> str | None:
    try:
        email, expires, _ = (cookie or "").split("|")
        valid = hmac.compare_digest(sign(secret, email, int(expires)), cookie or "")
        return email if valid and int(expires) > time.time() else None
    except ValueError:
        return None


def signed_in_user(settings: Settings, request: Request) -> str | None:
    return verify(settings.session_secret, request.cookies.get(COOKIE))


def login_redirect(request: Request) -> RedirectResponse:
    return RedirectResponse(f"/login?next={quote(request.url.path)}", status_code=303)


def see_other(path: str) -> RedirectResponse:
    return RedirectResponse(path, status_code=303)


def credentials_match(settings: Settings, email: str, password: str) -> bool:
    # Both comparisons always run, so the response time does not reveal which one failed.
    typed_email = email.lower().encode()
    approver_email = settings.approver_email.lower().encode()
    email_ok = hmac.compare_digest(typed_email, approver_email)
    password_ok = hmac.compare_digest(password.encode(), settings.approver_password.encode())
    return email_ok & password_ok


def safe_next_path(next_path: str) -> str:
    """Only a path on this site, so a crafted login link cannot send the approver elsewhere."""
    if next_path.startswith("/") and not next_path.startswith("//"):
        return next_path
    return "/"


def create_app(*, settings: Settings, remediations: Remediations, telemetry=None, lifespan=None):
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
    add_login_routes(app, settings, remediations)
    add_page_routes(app, settings, remediations)
    add_decision_routes(app, settings, remediations)
    add_api_routes(app, settings, remediations)
    app.mount("/", mcp_app)
    return app


def add_login_routes(app: FastAPI, settings: Settings, remediations: Remediations) -> None:
    @app.get("/healthz")
    def healthz():
        remediations.store.events(kind="healthz")
        return {"ok": True}

    @app.get("/login", response_class=HTMLResponse)
    def login_page(request: Request, next: str = "/"):
        return templates.TemplateResponse(request, "login.html", {"next": next, "error": None})

    @app.post("/login")
    def login(request: Request, email: str = Form(), password: str = Form(), next: str = Form("/")):
        if not credentials_match(settings, email, password):
            context = {"next": next, "error": "That email and password do not match."}
            return templates.TemplateResponse(request, "login.html", context, status_code=401)
        response = see_other(safe_next_path(next))
        expires = int(time.time()) + SESSION_S
        response.set_cookie(
            COOKIE,
            sign(settings.session_secret, email.lower(), expires),
            httponly=True,
            samesite="lax",
            secure=settings.public_url.startswith("https://"),
            max_age=SESSION_S,
        )
        return response


def add_page_routes(app: FastAPI, settings: Settings, remediations: Remediations) -> None:
    store = remediations.store

    @app.get("/", response_class=HTMLResponse)
    def incidents(request: Request):
        if not (who := signed_in_user(settings, request)):
            return login_redirect(request)
        context = {"who": who, "incidents": store.incidents()}
        return templates.TemplateResponse(request, "incidents.html", context)

    @app.get("/incidents/{incident_id}", response_class=HTMLResponse)
    def incident(request: Request, incident_id: str):
        if not (who := signed_in_user(settings, request)):
            return login_redirect(request)
        try:
            found = store.incident(incident_id)
        except KeyError:
            return HTMLResponse("No such incident", status_code=404)
        context = {
            "who": who,
            "incident": found,
            "actions": remediations.actions_for(incident_id),
            "timeline": store.events(incident_id=incident_id),
            "findings": remediations.findings_for(incident_id),
            "mcp_url": f"{settings.public_url}/mcp",
        }
        return templates.TemplateResponse(request, "incident.html", context)

    @app.get("/actions/{action_id}", response_class=HTMLResponse)
    def action(request: Request, action_id: str, error: str | None = None):
        if not (who := signed_in_user(settings, request)):
            return login_redirect(request)
        try:
            state = remediations.status(action_id)
        except KeyError:
            return HTMLResponse("No such remediation", status_code=404)
        every_target = {target for targets in ACTIONS.values() for target in targets}
        context = {
            "who": who,
            "a": state,
            "incident": store.incident(state.incident_id),
            "blast_radius": BLAST_RADIUS[state.action],
            "actions": ACTIONS,
            "targets": sorted(every_target),
            "error": error,
        }
        return templates.TemplateResponse(request, "action.html", context)


def decide(
    settings: Settings, request: Request, action_id: str, record_decision: Callable[[str], object]
) -> RedirectResponse:
    """Record a decision as the signed-in approver, then show the action again."""
    if not (who := signed_in_user(settings, request)):
        return login_redirect(request)
    try:
        record_decision(who)
    except (InvalidTransitionError, PolicyError) as err:
        return see_other(f"/actions/{action_id}?error={quote(str(err))}")
    return see_other(f"/actions/{action_id}")


def only_allowed_params(action: str, target: str) -> dict[str, str]:
    # Each allowed parameter has exactly one allowed value, so the form only picks action and
    # target.
    allowed = ACTIONS.get(action, {}).get(target, {})
    return {name: next(iter(values)) for name, values in allowed.items()}


def add_decision_routes(app: FastAPI, settings: Settings, remediations: Remediations) -> None:
    @app.post("/actions/{action_id}/approve")
    def approve(request: Request, action_id: str):
        def record_approval(who: str):
            return remediations.approve(action_id, approver=who)

        return decide(settings, request, action_id, record_approval)

    @app.post("/actions/{action_id}/reject")
    def reject(request: Request, action_id: str, reason: str = Form("")):
        def record_rejection(who: str):
            return remediations.reject(action_id, approver=who, reason=reason)

        return decide(settings, request, action_id, record_rejection)

    @app.post("/actions/{action_id}/edit")
    def edit(request: Request, action_id: str, action: str = Form(), target: str = Form()):
        plan = PlannedAction(action, target, only_allowed_params(action, target))

        def record_edit(who: str):
            return remediations.edit(action_id, editor=who, plan=plan)

        return decide(settings, request, action_id, record_edit)


def add_api_routes(app: FastAPI, settings: Settings, remediations: Remediations) -> None:
    @app.post("/api/incidents")
    def page(body: dict, authorization: str = Header("")):
        # A person or a noisy alert can page by hand; the incident it opens is like any other.
        expected = f"Bearer {settings.mcp_token}".encode()
        if not hmac.compare_digest(authorization.encode(), expected):
            return JSONResponse({"error": "a bearer token is required"}, status_code=401)
        report = IncidentReport(
            rule="manual_page",
            service=str(body.get("service", "")),
            summary=str(body.get("summary", "")),
            details={"paged_by": str(body.get("paged_by", "on-call"))},
        )
        found = remediations.store.open_incident(report, opened_at=datetime.now(UTC))
        return {"incident_id": found.id}

    @app.exception_handler(KeyError)
    def not_found(request: Request, error: KeyError):
        return JSONResponse({"error": f"not found: {error}"}, status_code=404)
