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
    person = assignee.get("name", "Sin asignar") if assignee else "Sin asignar"
    header = f"#TASK-{ticket['id']:04d}  {clean(ticket['priority'])}  {clean(ticket['status'])}"
    # El titulo va a doble ancho, asi que entra la mitad de caracteres por linea.
    title = "\n".join(textwrap.wrap(clean(ticket["title"]).upper(), max(columns // 2, 12)))
    meta = f"{clean(person)} - {clean(ticket.get('deadline') or 'Sin fecha')}"
    return header, title, "\n".join(textwrap.wrap(meta, columns))


def ticket_text(ticket: dict[str, Any], columns: int = 48) -> str:
    return "\n".join(ticket_lines(ticket, columns)) + "\n"


def render(printer: ReceiptPrinter, ticket: dict[str, Any], columns: int = 48) -> None:
    header, title, meta = ticket_lines(ticket, columns)
    # ponytail: el diseño sale de los atributos del propio ESC/POS (invertido, doble tamaño,
    # fuente B), no de dibujar marcos con guiones: mas contraste y menos centimetros de papel.
    printer.set(align="center", font="a", width=1, height=1, bold=True, invert=True)
    printer.text(header.center(columns) + "\n")  # banda negra a lo ancho del papel
    printer.set(invert=False, width=2, height=2)
    printer.text(title + "\n")
    printer.set(width=1, height=1, bold=False, font="b")
    printer.text(meta + "\n")
    printer.set(font="a")
    printer.qr(clean(ticket["url"]), size=4, native=False)
    printer.cut()  # cut() ya alimenta 6 lineas; no hace falta rellenar antes.
