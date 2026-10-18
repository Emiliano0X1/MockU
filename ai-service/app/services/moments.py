"""
Turns AssemblyAI word timestamps into transcript segments and timed findings
("moments") for a whole interview. All times are milliseconds from the start
of the audio, which the app aligns with the session's started_at.
"""

FILLERS = {
    "en": {"um", "uh", "like", "actually", "basically"},
    "es": {"este", "eh", "ah", "bueno", "digamos"},
}

LONG_PAUSE_MS = 2000  # same threshold as metrics.calculate_metrics
VERY_LONG_PAUSE_MS = 5000
FILLER_WINDOW_MS = 10000  # fillers this close together form one cluster
FILLER_CLUSTER_MIN = 3
REPEAT_MERGE_MS = 5000  # repetitions this close together form one moment

SEGMENT_MAX_WORDS = 30
SEGMENT_BREAK_MS = 1200


def _clean(text: str) -> str:
    return text.lower().strip(".,!?;:\"'")


def build_segments(words: list) -> list:
    """Groups words into readable segments, breaking at sentence ends, pauses or length."""
    segments, current = [], []
    for i, word in enumerate(words):
        current.append(word)
        nxt = words[i + 1] if i + 1 < len(words) else None
        sentence_end = word["text"].rstrip().endswith((".", "?", "!"))
        pause = nxt is not None and nxt["start"] - word["end"] >= SEGMENT_BREAK_MS
        if nxt is None or sentence_end or pause or len(current) >= SEGMENT_MAX_WORDS:
            segments.append({
                "start_ms": current[0]["start"],
                "end_ms": current[-1]["end"],
                "text": " ".join(w["text"] for w in current),
            })
            current = []
    return segments


def _words_between(words: list, start_ms: int, end_ms: int) -> list:
    return [w for w in words if w["start"] >= start_ms and w["end"] <= end_ms]


def answer_windows(questions: list, words: list, audio_end_ms: int) -> list:
    """
    Each question's answer runs from when it was shown until the next question
    was shown (or the end of the audio). Questions never shown are skipped.
    """
    shown = sorted((q for q in questions if q.get("asked_at_ms") is not None), key=lambda q: q["asked_at_ms"])
    windows = []
    for i, q in enumerate(shown):
        start = q["asked_at_ms"]
        end = shown[i + 1]["asked_at_ms"] if i + 1 < len(shown) else audio_end_ms
        answer_words = _words_between(words, start, end)
        windows.append({
            "position": q["position"],
            "question": q["text"],
            "start_ms": start,
            "end_ms": end,
            "words": answer_words,
            "transcript": " ".join(w["text"] for w in answer_words),
        })
    return windows


def timed_findings(words: list, language: str = "en") -> list:
    """Long pauses, filler clusters and repetitions, each with exact start/end times."""
    fillers = FILLERS.get(language, FILLERS["en"])
    findings = []

    # Long pauses between words. Leading silence before the first word is
    # reading time, not a pause, so only gaps between spoken words count.
    for prev, word in zip(words, words[1:]):
        gap = word["start"] - prev["end"]
        if gap > LONG_PAUSE_MS:
            findings.append({
                "category": "pauses",
                "start_ms": prev["end"],
                "end_ms": word["start"],
                "severity": "high" if gap >= VERY_LONG_PAUSE_MS else "medium",
                "title": f"{gap / 1000:.1f}s pause",
                "details": {
                    "note": f'You stopped for {gap / 1000:.1f} seconds after "{prev["text"]}". '
                            "A short pause is fine; if you need time, say so (\"Let me think about that\").",
                },
            })

    # Clusters of filler words.
    filler_words = [w for w in words if _clean(w["text"]) in fillers]
    cluster = []
    for w in filler_words + [None]:
        if w is not None and (not cluster or w["start"] - cluster[-1]["start"] <= FILLER_WINDOW_MS):
            cluster.append(w)
            continue
        if len(cluster) >= FILLER_CLUSTER_MIN:
            used = sorted({_clean(c["text"]) for c in cluster})
            findings.append({
                "category": "fillers",
                "start_ms": cluster[0]["start"],
                "end_ms": cluster[-1]["end"],
                "severity": "high" if len(cluster) >= 6 else "medium",
                "title": f"{len(cluster)} filler words",
                "details": {
                    "note": f'You said {", ".join(used)} {len(cluster)} times in a few seconds. '
                            "Pausing silently sounds more confident than a filler.",
                    "count": len(cluster),
                    "words": used,
                },
            })
        cluster = [w] if w is not None else []

    # Repeated words ("the the"), merged when close together.
    repeats = [word for prev, word in zip(words, words[1:]) if _clean(word["text"]) == _clean(prev["text"]) and _clean(word["text"])]
    group = []
    for w in repeats + [None]:
        if w is not None and (not group or w["start"] - group[-1]["start"] <= REPEAT_MERGE_MS):
            group.append(w)
            continue
        if group:
            findings.append({
                "category": "restarts",
                "start_ms": max(0, group[0]["start"] - 1000),
                "end_ms": group[-1]["end"],
                "severity": "medium" if len(group) >= 2 else "low",
                "title": "Repeated words" if len(group) > 1 else f'Repeated "{_clean(group[0]["text"])}"',
                "details": {
                    "note": "Repeating words often means you started speaking before the thought was ready. "
                            "Take a breath and start the sentence once.",
                    "count": len(group),
                },
            })
        group = [w] if w is not None else []

    return sorted(findings, key=lambda f: f["start_ms"])
