from typing import Any

import httpx

from crokbit_agent.config import Config


class API:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.client = httpx.Client(
            base_url=str(config.api_url).rstrip("/"),
            headers={"X-Agent-Token": config.agent_token},
            timeout=15,
        )

    def heartbeat(self) -> None:
        self.client.post(
            f"/printers/{self.config.printer_id}/heartbeat", json={"agent_id": self.config.agent_id}
        ).raise_for_status()

    def claim(self) -> dict[str, Any] | None:
        response = self.client.post(
            f"/printers/{self.config.printer_id}/claim", json={"agent_id": self.config.agent_id}
        )
        response.raise_for_status()
        result: dict[str, Any] | None = response.json()
        return result

    def acknowledge(self, result: dict[str, Any]) -> None:
        response = self.client.patch(
            f"/print-jobs/{result['id']}",
            json={
                "agent_id": self.config.agent_id,
                "claim_token": result["claim_token"],
                "status": result["status"],
                "error": result.get("error"),
            },
        )
        response.raise_for_status()

    def close(self) -> None:
        self.client.close()
