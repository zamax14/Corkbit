import logging
from typing import Any

from escpos.printer import File, Network, Usb

from corkbit_agent.config import Config
from corkbit_agent.renderer import render, ticket_text

logger = logging.getLogger(__name__)


def print_job(config: Config, job: dict[str, Any]) -> None:
    printer: Any
    if config.transport == "file":
        config.output_dir.mkdir(parents=True, exist_ok=True)
        path = config.output_dir / f"job-{job['id']}-attempt-{job['attempts']}.bin"
        printer = File(str(path), profile=config.profile)
        path.with_suffix(".txt").write_text(
            ticket_text(job["ticket"], config.columns) + job["ticket"]["url"] + "\n",
            encoding="utf-8",
        )
        logger.info("Simulación ESC/POS: %s (no se envía a hardware)", path)
    elif config.transport == "device":
        # ponytail: el kernel (usblp) ya expone la impresora como archivo; escribir los bytes
        # ESC/POS ahi evita libusb y CUPS. Pasa a "usb" solo si usblp no toma el dispositivo.
        printer = File(str(config.device), profile=config.profile)
    elif config.transport == "network":
        printer = Network(config.host, port=config.port, timeout=10, profile=config.profile)
    else:
        printer = Usb(config.usb_vendor, config.usb_product, timeout=10000, profile=config.profile)
    try:
        render(printer, job["ticket"], config.columns)
    finally:
        printer.close()
