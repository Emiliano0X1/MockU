"""
BPM Simulator Script
Simulates realistic heart-rate series against an active interview session
to test the spike detector and glasses WebSocket warnings without an Apple Watch.

Usage:
  python scripts/simulate_bpm.py --session-id <SESSION_ID> --mode sustained_spike
"""

import argparse
import sys
import time
import requests

DEFAULT_BASE_URL = "http://localhost:8000/api/v1"


def send_sample_batch(base_url: str, session_id: str, samples: list) -> bool:
    url = f"{base_url}/sessions/{session_id}/biometrics"
    try:
        resp = requests.post(url, json={"samples": samples}, timeout=5)
        if resp.status_code == 201:
            print(f"  [+] Ingested {len(samples)} samples. Latest: t={samples[-1]['t_ms']}ms, bpm={samples[-1]['bpm']}")
            return True
        else:
            print(f"  [-] Failed ({resp.status_code}): {resp.text}")
            return False
    except Exception as e:
        print(f"  [!] Request error: {e}")
        return False


def simulate_session(base_url: str, session_id: str, scenario: str):
    print(f"Starting simulation for session: {session_id}")
    print(f"Scenario: {scenario}\n")

    t_ms = 0
    step_ms = 1000  # 1 sample per second

    # Phase 1: Warm-up period (65 seconds of steady baseline pulse 70-76 BPM)
    print(">> Phase 1: Warm-up (establishing ~74 BPM baseline for 65s)...")
    for _ in range(65):
        t_ms += step_ms
        bpm = 72 + (_ % 5)
        send_sample_batch(base_url, session_id, [{"t_ms": t_ms, "bpm": bpm}])
        time.sleep(0.1)  # fast simulation speed

    if scenario == "isolated_spike":
        print("\n>> Phase 2: Isolated Noise Spike (120 BPM for 2 seconds, then back to normal)...")
        # Spike for 2 seconds (less than 8s sustain window -> should NOT trigger suggestion)
        for _ in range(2):
            t_ms += step_ms
            send_sample_batch(base_url, session_id, [{"t_ms": t_ms, "bpm": 120}])
            time.sleep(0.1)

        # Return to baseline
        for _ in range(10):
            t_ms += step_ms
            send_sample_batch(base_url, session_id, [{"t_ms": t_ms, "bpm": 74}])
            time.sleep(0.1)
        print("Done. Verify that NO suggestion was triggered for the isolated spike.")

    elif scenario == "sustained_spike":
        print("\n>> Phase 2: Sustained Spike (holding 105-115 BPM for 12 seconds)...")
        # Spike sustained for 12 seconds (> 8s sustain window -> SHOULD trigger suggestion!)
        for i in range(12):
            t_ms += step_ms
            bpm = 106 + (i % 6)
            send_sample_batch(base_url, session_id, [{"t_ms": t_ms, "bpm": bpm}])
            time.sleep(0.2)

        print("\n>> Phase 3: Recovery (falling back below baseline + 8 BPM to re-arm)...")
        for _ in range(15):
            t_ms += step_ms
            send_sample_batch(base_url, session_id, [{"t_ms": t_ms, "bpm": 72}])
            time.sleep(0.1)
        print("Done. Check the glasses WebSocket or GET /sessions/{id}/suggestions.")

    else:
        print(f"Unknown scenario: {scenario}. Available: 'sustained_spike', 'isolated_spike'")


def main():
    parser = argparse.ArgumentParser(description="Simulate BPM telemetry for MockU Live Mode")
    parser.add_argument("--session-id", required=True, help="UUID of active recording session")
    parser.add_argument("--scenario", default="sustained_spike", choices=["sustained_spike", "isolated_spike"])
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Base API URL")

    args = parser.parse_args()
    simulate_session(args.base_url, args.session_id, args.scenario)


if __name__ == "__main__":
    main()
