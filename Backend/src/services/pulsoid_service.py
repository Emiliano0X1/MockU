import asyncio
import json
import logging
from typing import Optional

# Safe import for external outbound WebSocket client
try:
    # pyrefly: ignore[missing-import]
    import websockets
except ImportError:
    websockets = None

from src.core.live_config import (
    PULSOID_ACCESS_TOKEN,
    PULSOID_ENABLED,
)
from src.services.live_manager import live_manager

logger = logging.getLogger("pulsoid_listener")


async def pulsoid_listener(session_id: str) -> None:
    """
    Outbound client connecting to Pulsoid's external WebSocket feed.
    Receives real-time heart rate from the watch and forwards it to live_manager.
    """
    if not PULSOID_ENABLED or not PULSOID_ACCESS_TOKEN:
        logger.info("Pulsoid integration is disabled or token is missing.")
        return

    if websockets is None:
        logger.warning(
            "The 'websockets' package is required to connect to Pulsoid. "
            "Install it with: pip install websockets"
        )
        return

    # WebSocket endpoint (token kept strictly out of logs)
    uri = f"wss://dev.pulsoid.net/api/v1/data/real_time?access_token={PULSOID_ACCESS_TOKEN}"
    backoff = 1.0

    while True:
        session = live_manager.get_session(session_id)
        if not session or not session.is_active:
            break

        try:
            logger.info("Connecting to Pulsoid external WebSocket feed...")
            async with websockets.connect(uri, ping_interval=20, ping_timeout=15) as ws:
                backoff = 1.0
                logger.info("Connected to Pulsoid. Listening for live heart rate...")

                async for raw_message in ws:
                    if not session.is_active:
                        break

                    try:
                        data = json.loads(raw_message)
                        bpm = None
                        if isinstance(data, dict):
                            if "data" in data and isinstance(data["data"], dict):
                                bpm = data["data"].get("heart_rate")
                            elif "heart_rate" in data:
                                bpm = data.get("heart_rate")
                            elif "bpm" in data:
                                bpm = data.get("bpm")

                        if bpm is not None and isinstance(bpm, int) and 20 <= bpm <= 260:
                            await live_manager.ingest_sample(session_id=session_id, bpm=bpm)
                    except Exception as parse_err:
                        logger.debug("Failed to parse Pulsoid message: %s", str(parse_err))

        except asyncio.CancelledError:
            break
        except Exception as conn_err:
            logger.warning("Pulsoid connection lost: %s. Reconnecting in %.1fs...", str(conn_err), backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2.0, 30.0)


def start_pulsoid_for_session(session_id: str) -> Optional[asyncio.Task]:
    """Start background Pulsoid listener task for an active interview session."""
    session = live_manager.get_session(session_id)
    if not session or not PULSOID_ENABLED or not PULSOID_ACCESS_TOKEN or websockets is None:
        return None

    if session.pulsoid_task is None or session.pulsoid_task.done():
        session.pulsoid_task = asyncio.create_task(pulsoid_listener(session_id))
    return session.pulsoid_task
