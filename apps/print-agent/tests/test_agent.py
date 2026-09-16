import json
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest

from corkbit_agent.config import Config
from corkbit_agent.main import Agent
from corkbit_agent.printer import print_job
from corkbit_agent.renderer import clean, render, ticket_lines


@pytest.fixture()
def config(tmp_path: Path) -> Config:
    return Config(
        agent_token="test-secret", state_dir=tmp_path / "state", output_dir=tmp_path / "tickets"
    )


@pytest.fixture()
def job() -> dict:
    return {
        "id": 10,
        "claim_token": "token",
        "attempts": 1,
        "ticket": {
            "id": 142,
            "title": "Integración con el MCP",
            "priority": "HIGH",
            "assignee": {"name": "Álex"},
            "deadline": "2026-09-11",
            "status": "BACKLOG",
            "url": "https://board.example.test/t/142",
        },
    }


def test_ticket_contains_required_fields_and_qr(job: dict):
    printer = Mock()
    render(printer, job["ticket"])
    text = "".join(call.args[0] for call in printer.text.call_args_list)
    for expected in [
        "TASK-0142",
        "Alta",
        "Integración con el MCP",
        "Álex",
        "2026-09-11",
    ]:
        assert expected in text
    printer.qr.assert_called_once_with(job["ticket"]["url"], size=4, native=False)
    printer.cut.assert_called_once()
    assert clean("title\x1b@\x1dv\nnext") == "title @ v next"


def test_real_escpos_file_output(config: Config, job: dict):
    print_job(config, job)
    binary = config.output_dir / "job-10-attempt-1.bin"
    assert binary.stat().st_size > 1000  # Includes raster QR, not a placeholder string.
    assert "https://board.example.test/t/142" in binary.with_suffix(".txt").read_text()


def test_network_ack_failure_never_reprints(config: Config, job: dict):
    api = Mock()
    api.claim.return_value = job
    api.acknowledge.side_effect = [httpx.ConnectError("offline"), None]
    output = Mock()
    agent = Agent(config, api, output)
    with pytest.raises(httpx.ConnectError):
        agent.tick()
    assert json.loads(agent.outbox.read_text())["status"] == "PRINTED"
    agent.tick()
    output.assert_called_once_with(config, job)
    assert api.claim.call_count == 1
    assert not agent.outbox.exists()


def test_printer_failure_reports_to_queue(config: Config, job: dict):
    api = Mock()
    api.claim.return_value = job
    agent = Agent(config, api, Mock(side_effect=OSError("No paper")))
    agent.tick()
    result = api.acknowledge.call_args.args[0]
    assert result["status"] == "FAILED" and result["error"] == "No paper"
    assert not agent.outbox.exists()


def test_crash_during_physical_write_is_not_replayed(config: Config, job: dict):
    api = Mock()
    output = Mock()
    agent = Agent(config, api, output)
    agent.outbox.write_text(
        json.dumps({"id": job["id"], "status": "PRINTING", "claim_token": job["claim_token"]})
    )
    agent.tick()
    output.assert_not_called()
    api.claim.assert_not_called()
    api.acknowledge.assert_not_called()
    assert (config.state_dir / "uncertain-10.json").exists()


def test_late_ack_archived_without_reprint(config: Config, job: dict):
    api = Mock()
    request = httpx.Request("PATCH", "https://example.test/print-jobs/10")
    api.acknowledge.side_effect = httpx.HTTPStatusError(
        "expired", request=request, response=httpx.Response(409, request=request)
    )
    output = Mock()
    agent = Agent(config, api, output)
    agent.outbox.write_text(json.dumps({"id": 10, "status": "PRINTED", "claim_token": "token"}))
    agent.tick()
    output.assert_not_called()
    assert (config.state_dir / "unacknowledged-10.json").exists()


@pytest.mark.parametrize("columns", [32, 48])
def test_ticket_wraps_without_empty_metadata(job: dict, columns: int):
    ticket = {**job["ticket"], "title": "Revisar " * 25, "assignee": None, "deadline": None}
    header, title, meta = ticket_lines(ticket, columns)
    assert "BACKLOG" not in header
    assert len(header) <= columns
    assert max(map(len, title.splitlines())) <= columns // 2
    assert title.replace("\n", " ") == ticket["title"].strip()
    assert meta == ""
