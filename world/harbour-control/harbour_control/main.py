"""Boot: validate settings, migrate the sre database, start the detector loop, serve on :8090."""

import asyncio
import contextlib
import logging
import os

import clickhouse_connect
import uvicorn

from harbour_control.approvals import Remediations
from harbour_control.config import Settings, load_settings
from harbour_control.detector import ClickHouseSignals, Detector
from harbour_control.queries import load_queries
from harbour_control.runner import ComposeRunner
from harbour_control.store import ClickHouseStore, utcnow
from harbour_control.telemetry import ClickHouseTelemetry
from harbour_control.web import create_app

log = logging.getLogger("harbour_control")


def clickhouse(settings: Settings, user: str, password: str):
    return clickhouse_connect.get_client(
        host=settings.clickhouse_host,
        port=8123,
        username=user,
        password=password,
        connect_timeout=5,
        send_receive_timeout=20,
        autogenerate_session_id=False,
    )


def build(settings: Settings):
    queries = load_queries(settings.sql_dir)
    store = ClickHouseStore(clickhouse(settings, settings.writer_user, settings.writer_password))
    store.migrate([q.sql for name, q in queries.items() if name.startswith("create_")])
    telemetry = ClickHouseTelemetry(
        clickhouse(settings, settings.reader_user, settings.reader_password), queries
    )
    runner = ComposeRunner(settings.world_dir)
    remediations = Remediations(store=store, telemetry=telemetry, runner=runner)
    detector = Detector(
        signals=ClickHouseSignals(telemetry), store=store, clock=utcnow, remediations=remediations
    )
    return store, telemetry, remediations, detector


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = load_settings(os.environ)
    store, telemetry, remediations, detector = build(settings)

    async def detector_loop():
        while True:
            try:
                await asyncio.to_thread(detector.tick)
            except Exception:
                log.exception("detector tick failed; retrying next interval")
            await asyncio.sleep(settings.detector_interval_s)

    @contextlib.asynccontextmanager
    async def lifespan(app):
        async with app.state.mcp_app.lifespan(app):
            task = asyncio.create_task(detector_loop())
            yield
            task.cancel()

    app = create_app(
        settings=settings,
        remediations=remediations,
        store=store,
        telemetry=telemetry,
        lifespan=lifespan,
    )
    uvicorn.run(app, host="0.0.0.0", port=8090, log_level="info")  # noqa: S104  container port


if __name__ == "__main__":
    main()
