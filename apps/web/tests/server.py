"""Isolated, migrated backend for browser tests; never touches the development database."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory(prefix="crokbit-e2e-") as directory:
    os.environ["DATABASE_URL"] = f"sqlite:///{directory}/e2e.db"
    os.environ["AGENT_TOKEN"] = "browser-test-token"
    os.environ["PUBLIC_BASE_URL"] = "http://127.0.0.1:5174"
    os.environ["WIP_LIMIT"] = "1"
    api = Path(__file__).resolve().parents[2] / "api"
    os.chdir(api)
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)
    subprocess.run([sys.executable, "-m", "app.cli", "printer"], check=True)
    subprocess.run([sys.executable, "-m", "uvicorn", "tests.e2e_app:app", "--port", "8011"], check=True)
