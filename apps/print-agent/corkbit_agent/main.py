import json
import logging
import os
import signal
import threading
from collections.abc import Callable
from pathlib import Path
from types import FrameType
from typing import Any

import httpx

from corkbit_agent.api import API
from corkbit_agent.config import Config
from corkbit_agent.printer import print_job

logger = logging.getLogger(__name__)


def persist(path: Path, data: dict[str, Any]) -> None:
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(data, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


class Agent:
    def __init__(
        self, config: Config, api: API, output: Callable[[Config, dict[str, Any]], None] = print_job
    ) -> None:
        self.config, self.api, self.output = config, api, output
        config.state_dir.mkdir(parents=True, exist_ok=True)
        self.outbox = config.state_dir / "inflight.json"

    def tick(self) -> None:
        self.api.heartbeat()
        if self.outbox.exists():
            result = json.loads(self.outbox.read_text(encoding="utf-8"))
            if result["status"] == "PRINTING":
                # Process died around a physical side effect. Never blindly print it again.
                logger.error(
                    "Ticket %s con resultado desconocido; revisa el papel. "
                    "Se dejará vencer la reserva.",
                    result["id"],
                )
                self.outbox.replace(self.config.state_dir / f"uncertain-{result['id']}.json")
                return
            try:
                self.api.acknowledge(result)
            except httpx.HTTPStatusError as error:
                if error.response.status_code != 409:
                    raise
                logger.error(
                    "La reserva %s expiró; resultado físico: %s. Revisar cola.",
                    result["id"],
                    result["status"],
                )
                self.outbox.replace(self.config.state_dir / f"unacknowledged-{result['id']}.json")
                return
            self.outbox.unlink()
            logger.info("Ticket %s: %s", result["id"], result["status"])
            return
        job = self.api.claim()
        if job is None:
            return
        result = {"id": job["id"], "claim_token": job["claim_token"], "status": "PRINTING"}
        persist(self.outbox, result)
        try:
            self.output(self.config, job)
            result["status"] = "PRINTED"
        except Exception as error:
            logger.exception("Error al imprimir ticket %s", job["id"])
            result.update(status="FAILED", error=str(error)[:2000])
        persist(self.outbox, result)
        self.api.acknowledge(result)
        self.outbox.unlink()
        logger.info("Ticket %s: %s", job["id"], result["status"])


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = Config()  # type: ignore[call-arg]
    api = API(config)
    agent = Agent(config, api)
    stop = threading.Event()

    def shutdown(signum: int, frame: FrameType | None) -> None:
        stop.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    failures = 0
    logger.info("Agente %s iniciado, transporte=%s", config.agent_id, config.transport)
    try:
        while not stop.is_set():
            try:
                agent.tick()
                failures = 0
            except Exception:
                failures += 1
                logger.exception("Conexión/proceso fallido; se reintentará")
            stop.wait(min(30, config.poll_seconds * (2 ** min(failures, 4))))
    finally:
        api.close()


if __name__ == "__main__":
    main()
