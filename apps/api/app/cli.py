import argparse
from datetime import date, timedelta

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.entities import Printer, User
from app.schemas.dto import TaskCreate
from app.services.tasks import create_task


def main() -> None:
    parser = argparse.ArgumentParser(description="Configura Corkbit")
    parser.add_argument("command", choices=["printer", "demo"])
    parser.add_argument("--agent-id", default="office-agent")
    parser.add_argument("--name", default="Impresora de oficina · 80 mm")
    parser.add_argument("--location", default="Oficina")
    args = parser.parse_args()
    with SessionLocal() as db:
        if args.command == "printer":
            existing = db.scalar(select(Printer).where(Printer.agent_id == args.agent_id))
            if existing:
                print(f"Impresora {existing.id} ya configurada para {args.agent_id}")
                return
            printer = Printer(name=args.name, location=args.location, agent_id=args.agent_id)
            db.add(printer)
            db.commit()
            print(f"Impresora {printer.id} configurada para {args.agent_id}")
        else:
            if db.scalar(select(User.id).limit(1)):
                raise SystemExit("Los datos demo requieren una base sin usuarios.")
            # Un `subject` sintetico: `users_list` solo devuelve identidades espejo de Keycloak,
            # y sin el los miembros de ejemplo existirian en la base pero no saldrian en la web.
            users = [
                User(subject=f"demo:{name.lower()}", name=name)
                for name in ["Alex", "Paulino", "Mariana"]
            ]
            db.add_all(users)
            db.flush()
            samples = [
                (
                    "Preparar la integración MCP SIEEJ",
                    "Dejar todo listo para las primeras pruebas.",
                    0,
                    "HIGH",
                    "BACKLOG",
                    3,
                ),
                (
                    "Dar forma al nuevo dashboard",
                    "Una primera mirada a los indicadores del mes.",
                    1,
                    "MEDIUM",
                    "BACKLOG",
                    5,
                ),
                (
                    "Documentar el flujo de datos",
                    "Un mapa sencillo para que todos estemos en sintonía.",
                    2,
                    "LOW",
                    "BACKLOG",
                    7,
                ),
                (
                    "Corregir el pipeline de población",
                    "Revisar la carga y validar los totales.",
                    0,
                    "URGENT",
                    "WIP",
                    1,
                ),
                (
                    "Revisar los indicadores de septiembre",
                    "Los últimos detalles antes de compartir.",
                    1,
                    "MEDIUM",
                    "WIP",
                    4,
                ),
                (
                    "Conectar el primer tablero",
                    "Un pequeño paso. Un buen comienzo.",
                    2,
                    "LOW",
                    "DONE",
                    0,
                ),
            ]
            for title, description, person, priority, status, days in samples:
                create_task(
                    db,
                    TaskCreate.model_validate(
                        {
                            "title": title,
                            "description": description,
                            "assignee_id": users[person].id,
                            "priority": priority,
                            "status": status,
                            "deadline": date.today() + timedelta(days=days),
                        }
                    ),
                )
            db.commit()
            print("6 tareas de demostración creadas.")


if __name__ == "__main__":
    main()
