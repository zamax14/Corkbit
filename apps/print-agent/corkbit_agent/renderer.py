import textwrap
from typing import Any, Protocol


class ReceiptPrinter(Protocol):
    def set(self, **kwargs: Any) -> None: ...
    def text(self, text: str) -> None: ...
    def qr(self, content: str, **kwargs: Any) -> None: ...
    def cut(self) -> None: ...


def clean(value: object) -> str:
    # Task input must never become ESC/POS control commands (ESC, GS, etc.).
    return " ".join("".join(c if c.isprintable() else " " for c in str(value)).split())


def ticket_lines(ticket: dict[str, Any], columns: int = 48) -> tuple[str, str, str]:
    """Cabecera, titulo y metadatos. render() los estiliza; ticket_text() los aplana."""
    assignee = ticket.get("assignee")
    priority = {"LOW": "Baja", "MEDIUM": "Media", "HIGH": "Alta", "URGENT": "Urgente"}
    label = priority.get(ticket["priority"], clean(ticket["priority"]))
    header = f"TASK-{ticket['id']:04d} / {label}"
    header = "\n".join(textwrap.wrap(header, columns))
    title = "\n".join(textwrap.wrap(clean(ticket["title"]), max(columns // 2, 1)))
    meta = []
    if assignee and assignee.get("name"):
        meta.extend(textwrap.wrap(clean(assignee["name"]), columns))
    if ticket.get("deadline"):
        meta.extend(textwrap.wrap(f"Para {clean(ticket['deadline'])}", columns))
    return header, title, "\n".join(meta)


def ticket_text(ticket: dict[str, Any], columns: int = 48) -> str:
    return "\n".join(ticket_lines(ticket, columns)) + "\n"


def render(printer: ReceiptPrinter, ticket: dict[str, Any], columns: int = 48) -> None:
    header, title, meta = ticket_lines(ticket, columns)
    printer.set(align="left", font="a", width=1, height=1, bold=False, invert=False)
    printer.text(header + "\n\n")
    printer.set(width=2, height=2, bold=True)
    printer.text(title + "\n\n")
    printer.set(width=1, height=1, bold=False)
    if meta:
        printer.text(meta + "\n")
    printer.set(align="center")
    printer.qr(clean(ticket["url"]), size=4, native=False)
    printer.text("Escanea para ver la tarea\n")
    printer.cut()
