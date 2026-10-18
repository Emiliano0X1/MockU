import asyncio
from datetime import datetime, timezone
import json
import time
from typing import Any, Dict, List, Optional
from uuid import uuid4
from fastapi import WebSocket, WebSocketDisconnect
from src.core.config import supabase
from src.core.live_config import (
    LIVE_MAX_SESSION_MIN,
    PULSOID_ACCESS_TOKEN,
    PULSOID_ENABLED,
    detector_config,
)
from src.services.spike_detector import DetectorState, evaluate_sample


class LiveSession:
    def __init__(self, session_id: str, started_at_iso: str):
        self.session_id = session_id
        self.started_at = datetime.fromisoformat(started_at_iso.replace("Z", "+00:00"))
        self.detector_state = DetectorState()
        self.glasses_ws: Optional[WebSocket] = None
        self.sensor_online: bool = False
        self.last_bpm: Optional[int] = None
        self.last_sample_mono: float = 0.0
        self.sample_buffer: List[Dict[str, Any]] = []
        self.pulsoid_task: Optional[asyncio.Task] = None
        self.periodic_task: Optional[asyncio.Task] = None
        self.is_active: bool = True


class LiveSessionManager:
    """Singleton manager controlling real-time glasses WebSockets and biometric ingestion."""

    def __init__(self):
        self.active_sessions: Dict[str, LiveSession] = {}

    def get_or_create_session(self, session_id: str, started_at_iso: str) -> LiveSession:
        if session_id not in self.active_sessions:
            session = LiveSession(session_id, started_at_iso)
            self.active_sessions[session_id] = session
            session.periodic_task = asyncio.create_task(self._periodic_session_loop(session))
        return self.active_sessions[session_id]

    def get_session(self, session_id: str) -> Optional[LiveSession]:
        return self.active_sessions.get(session_id)

    async def register_glasses(self, session_id: str, ws: WebSocket, started_at_iso: str) -> LiveSession:
        """Register or replace an active glasses WebSocket for a session."""
        session = self.get_or_create_session(session_id, started_at_iso)

        # Close existing connection if one is open
        if session.glasses_ws is not None and session.glasses_ws != ws:
            try:
                await session.glasses_ws.close(code=1000, reason="Replaced by new connection")
            except Exception:
                pass

        session.glasses_ws = ws

        # Send initial sensor status
        await self.send_sensor_status(session)
        return session

    def unregister_glasses(self, session_id: str, ws: WebSocket) -> None:
        session = self.get_session(session_id)
        if session and session.glasses_ws == ws:
            session.glasses_ws = None

    async def send_sensor_status(self, session: LiveSession) -> None:
        """Send sensor_status message over WebSocket."""
        if session.glasses_ws:
            payload = {
                "type": "sensor_status",
                "state": "online" if session.sensor_online else "offline",
                "last_bpm": session.last_bpm,
            }
            try:
                await session.glasses_ws.send_text(json.dumps(payload))
            except Exception:
                session.glasses_ws = None

    async def push_suggestion(
        self,
        session: LiveSession,
        suggestion_id: str,
        t_ms: int,
        text: str,
        severity: str,
        ttl_ms: int,
    ) -> bool:
        """Push a suggestion warning to the glasses HUD."""
        if not session.glasses_ws:
            return False

        msg = {
            "type": "suggestion",
            "id": suggestion_id,
            "t_ms": t_ms,
            "text": text,
            "severity": severity,
            "ttl_ms": ttl_ms,
        }
        try:
            await session.glasses_ws.send_text(json.dumps(msg))
            return True
        except Exception:
            session.glasses_ws = None
            return False

    async def ingest_sample(self, session_id: str, bpm: int, explicit_t_ms: Optional[int] = None) -> None:
        """
        Process an incoming heart rate sample.
        Calculates t_ms from server receive time (or uses explicit t_ms in manual mode),
        evaluates against spike detector, and dispatches suggestions to glasses.
        """
        session = self.get_session(session_id)
        if not session or not session.is_active:
            return

        now_mono = time.monotonic()
        now_utc = datetime.now(timezone.utc)

        # Time contract: milliseconds since started_at (based on server receive time)
        if explicit_t_ms is not None:
            t_ms = explicit_t_ms
        else:
            elapsed_sec = (now_utc - session.started_at).total_seconds()
            t_ms = max(0, int(elapsed_sec * 1000))

        # Update sensor activity
        prev_online = session.sensor_online
        session.sensor_online = True
        session.last_bpm = bpm
        session.last_sample_mono = now_mono

        # Buffer sample for bulk database flush
        session.sample_buffer.append(
            {
                "session_id": str(session_id),
                "t_ms": t_ms,
                "bpm": bpm,
            }
        )

        # Send every reading (not only the offline -> online transition) so the
        # app can show the live BPM.
        await self.send_sensor_status(session)

        # Evaluate against spike detector rules
        has_glasses = session.glasses_ws is not None
        suggestion_payload = evaluate_sample(
            t_ms=t_ms,
            bpm=bpm,
            state=session.detector_state,
            has_glasses_connected=has_glasses,
            is_stale=False,
        )

        if suggestion_payload:
            s_id = str(uuid4())
            # Save suggestion to database
            row = {
                "id": s_id,
                "session_id": str(session_id),
                "t_ms": t_ms,
                "text": suggestion_payload["text"],
                "severity": suggestion_payload["severity"],
                "trigger_reason": suggestion_payload["trigger_reason"],
                "bpm_at_trigger": suggestion_payload["bpm_at_trigger"],
                "baseline_bpm": suggestion_payload["baseline_bpm"],
                "delivered_at": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            try:
                supabase.table("live_suggestions").insert(row).execute()
            except Exception:
                pass

            # Push to connected glasses
            await self.push_suggestion(
                session=session,
                suggestion_id=s_id,
                t_ms=t_ms,
                text=suggestion_payload["text"],
                severity=suggestion_payload["severity"],
                ttl_ms=suggestion_payload["ttl_ms"],
            )

    async def flush_buffer(self, session: LiveSession) -> None:
        """Flush buffered samples to database in bulk."""
        if not session.sample_buffer:
            return

        to_insert = session.sample_buffer[:]
        session.sample_buffer.clear()

        try:
            supabase.table("biometric_samples").upsert(
                to_insert, on_conflict="session_id,t_ms"
            ).execute()
        except Exception:
            try:
                supabase.table("biometric_samples").insert(to_insert).execute()
            except Exception:
                pass

    async def _periodic_session_loop(self, session: LiveSession) -> None:
        """Periodic background task: checks sensor staleness, flushes buffer, sends pings."""
        ping_counter = 0

        while session.is_active:
            try:
                await asyncio.sleep(1.0)
                now_mono = time.monotonic()
                ping_counter += 1

                # 1. Staleness check
                stale_threshold_sec = detector_config.STALE_MS / 1000.0
                if session.sensor_online and (now_mono - session.last_sample_mono) > stale_threshold_sec:
                    session.sensor_online = False
                    await self.send_sensor_status(session)

                # 2. Flush sample buffer every 5 seconds
                if ping_counter % 5 == 0:
                    await self.flush_buffer(session)

                # 3. Send WebSocket ping every 20 seconds
                if ping_counter >= 20:
                    ping_counter = 0
                    if session.glasses_ws:
                        try:
                            await session.glasses_ws.send_text(json.dumps({"type": "ping"}))
                        except Exception:
                            session.glasses_ws = None

            except asyncio.CancelledError:
                break
            except Exception:
                pass

    async def end_session(self, session_id: str) -> None:
        """Cleanly end live tracking for an interview session."""
        session = self.active_sessions.pop(session_id, None)
        if not session:
            return

        session.is_active = False

        # Stop Pulsoid listener if running
        if session.pulsoid_task and not session.pulsoid_task.done():
            session.pulsoid_task.cancel()

        # Stop periodic task
        if session.periodic_task and not session.periodic_task.done():
            session.periodic_task.cancel()

        # Final buffer flush
        await self.flush_buffer(session)

        # Notify glasses and close WebSocket
        if session.glasses_ws:
            try:
                await session.glasses_ws.send_text(json.dumps({"type": "session_ended"}))
                await session.glasses_ws.close(code=1000, reason="Session ended")
            except Exception:
                pass
            session.glasses_ws = None


# Global LiveSessionManager instance
live_manager = LiveSessionManager()
