from pathlib import Path
from typing import Literal

from pydantic import Field, HttpUrl, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PRINT_", env_file=".env", extra="ignore")
    api_url: HttpUrl = HttpUrl("http://localhost:8000")
    agent_id: str = "office-agent"
    agent_token: str = Field(min_length=1)
    printer_id: int = Field(default=1, gt=0)
    transport: Literal["file", "network", "usb", "device"] = "file"
    device: Path = Path("/dev/usb/lp0")
    host: str = ""
    port: int = Field(default=9100, gt=0, le=65535)
    usb_vendor: int = 0x04B8
    usb_product: int = 0x0202
    profile: str = "TM-T88III"
    columns: int = Field(default=48, ge=24, le=64)
    poll_seconds: float = Field(default=3, ge=1, le=30)
    output_dir: Path = Path("./tickets")
    state_dir: Path = Path("./agent-state")

    @model_validator(mode="after")
    def transport_config(self) -> "Config":
        if self.transport == "network" and not self.host.strip():
            raise ValueError("PRINT_HOST es obligatorio para transporte network")
        if self.transport == "device" and not self.device.exists():
            raise ValueError(f"PRINT_DEVICE no existe: {self.device}")
        return self
