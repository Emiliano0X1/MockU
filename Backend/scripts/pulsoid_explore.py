"""
Pulsoid Exploration Script
Connects to the Pulsoid WebSocket using the configured PULSOID_ACCESS_TOKEN
and logs incoming live heart-rate packets.

Usage:
  python scripts/pulsoid_explore.py
"""

import asyncio
import json
import os
from dotenv import load_dotenv
import websockets

load_dotenv()

PULSOID_ACCESS_TOKEN = os.getenv("PULSOID_ACCESS_TOKEN", "")


async def explore():
    if not PULSOID_ACCESS_TOKEN:
        print("[!] Error: PULSOID_ACCESS_TOKEN is not set in your .env file.")
        return

    uri = f"wss://dev.pulsoid.net/api/v1/data/real_time?access_token={PULSOID_ACCESS_TOKEN}"
    print("[*] Connecting to Pulsoid real-time feed (token hidden)...")

    try:
        async with websockets.connect(uri) as ws:
            print("[+] Connected successfully! Waiting for messages from watch...\n")
            while True:
                msg = await ws.recv()
                print(f"[RAW PACKET]: {msg}")
                try:
                    parsed = json.loads(msg)
                    print(f"  Parsed JSON structure: {json.dumps(parsed, indent=2)}")
                except Exception:
                    pass
    except Exception as e:
        print(f"[!] Connection failed: {e}")


if __name__ == "__main__":
    asyncio.run(explore())
