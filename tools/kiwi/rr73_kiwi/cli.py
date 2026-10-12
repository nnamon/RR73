"""The record command."""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

from rr73_kiwi import IDENT
from rr73_kiwi.bands import FT8_DIAL_HZ
from rr73_kiwi.config import ConfigError, Receiver, load_receivers
from rr73_kiwi.politeness import FREE_CHANNELS, MAX_SESSION_S, MIN_SESSION_S, admission, rules_for
from rr73_kiwi.schedule import Clock, Request, ready_at, run_schedule
from rr73_kiwi.session import SessionContext, SessionResult, run_session
from rr73_kiwi.state import STATE_NAME, LockError, ReceiverState, receiver_dir
from rr73_kiwi.status import StatusError, fetch_status

EXIT_CONFIG = 1

DESCRIPTION = f"""\
Record FT8 slots from KiwiSDR receivers into the RR73 corpus.

Each session holds one channel on one receiver, tuned to the FT8 dial frequency of one band in
IQ mode with a 100 to 3000 Hz USB passband. The audio is resampled to exactly 12000 Hz and cut
into UTC-aligned 15 s slots: corpus/kiwi/<receiver>/<YYYYMMDD>/<YYMMDD_HHMMSS>.wav and .json.
Partial slots are discarded.

Rules on every receiver: one channel at a time; no connection while users >= users_max - {FREE_CHANNELS}
on /status; sessions of at most {MAX_SESSION_S // 60} minutes, then a break (club receivers at least
5 minutes, public receivers at least 30); the receiver's own time limits; a doubling backoff after
errors. The user name is "{IDENT}".

Add WSJT-X reference decodes afterwards:
  docker compose run --rm wsjtx reference.py corpus/kiwi
"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="record", description=DESCRIPTION, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--config", type=Path, default=Path("tools/kiwi/receivers.toml"), help="receiver file (default: %(default)s)"
    )
    parser.add_argument("--corpus", type=Path, default=Path("corpus"), help="corpus root (default: %(default)s)")
    parser.add_argument(
        "--receiver", action="append", default=[], metavar="ID", help="receiver to use; repeat for more (default: all)"
    )
    parser.add_argument(
        "--band",
        action="append",
        default=[],
        choices=list(FT8_DIAL_HZ),
        help="band to record; repeat to rotate (default: the receiver's plan for the UTC time)",
    )
    parser.add_argument(
        "--minutes",
        type=float,
        help=f"session length, {MIN_SESSION_S // 60} to {MAX_SESSION_S // 60} minutes (default: session_minutes)",
    )
    parser.add_argument(
        "--sessions", type=int, default=1, help="sessions to record, 0 for no limit (default: %(default)s)"
    )
    parser.add_argument("--hours", type=float, help="start no session after this many hours")
    parser.add_argument(
        "--ntp-server",
        default="pool.ntp.org",
        help="NTP server for the host clock offset, or 'none' (default: %(default)s)",
    )
    parser.add_argument(
        "--check", action="store_true", help="read each receiver's /status and print the plan without connecting"
    )
    parser.add_argument("--verbose", action="store_true", help="log kiwiclient protocol messages")
    return parser


def _configure_logging(verbose: bool) -> None:
    formatter = logging.Formatter("%(asctime)s UTC %(message)s", "%H:%M:%S")
    formatter.converter = time.gmtime
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.DEBUG if verbose else logging.WARNING)
    logging.getLogger("rr73_kiwi").setLevel(logging.DEBUG if verbose else logging.INFO)


def _check(receivers: list[Receiver], corpus: Path, bands: list[str]) -> int:
    now = time.time()
    when = datetime.fromtimestamp(now, tz=UTC)
    for receiver in receivers:
        state = ReceiverState.load(receiver_dir(corpus, receiver.id) / STATE_NAME)
        plan = ", ".join(bands or receiver.bands_at(when))
        rules = rules_for(receiver.access)
        try:
            status = fetch_status(receiver.host, receiver.port)
            decision = admission(status)
            verdict = ("may connect: " if decision.allowed else "would wait: ") + decision.reason
        except StatusError as exc:
            verdict = f"status unavailable: {exc}"
        ready = ready_at(receiver, state)
        next_text = "now" if ready <= now else datetime.fromtimestamp(ready, tz=UTC).strftime("%H:%M:%S UTC")
        print(f"{receiver.id} ({receiver.host}:{receiver.port}, {receiver.access})")
        print(f"  status: {verdict}")
        print(f"  next attempt allowed: {next_text}")
        print(f"  bands at {when:%H:%M} UTC: {plan}")
        print(
            f"  session {receiver.session_s / 60:g} min, break {receiver.break_s / 60:g} min, "
            f"busy wait {rules.busy_wait_s / 60:g} min, backoff from {rules.backoff_base_s / 60:g} min"
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    _configure_logging(args.verbose)
    log = logging.getLogger("rr73_kiwi")
    if args.minutes is not None and not MIN_SESSION_S <= args.minutes * 60 <= MAX_SESSION_S:
        log.error("--minutes must be from %d to %d", MIN_SESSION_S // 60, MAX_SESSION_S // 60)
        return EXIT_CONFIG
    if args.sessions < 0:
        log.error("--sessions must be 0 or more")
        return EXIT_CONFIG
    try:
        receivers = list(load_receivers(args.config))
    except ConfigError as exc:
        log.error("%s", exc)
        return EXIT_CONFIG
    if args.receiver:
        unknown = sorted(set(args.receiver) - {r.id for r in receivers})
        if unknown:
            log.error("unknown receivers %s in %s", unknown, args.config)
            return EXIT_CONFIG
        receivers = [r for r in receivers if r.id in args.receiver]
    if args.check:
        return _check(receivers, args.corpus, args.band)

    stop = threading.Event()

    def on_signal(signum: int, _frame: object) -> None:
        log.info("Stopping after %s: closing the connection", signal.Signals(signum).name)
        stop.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    ntp_server = None if args.ntp_server.lower() == "none" else args.ntp_server

    def runner(receiver: Receiver, band: str, length_s: float, state: ReceiverState) -> SessionResult:
        ctx = SessionContext(corpus_root=args.corpus, stop=stop, ntp_server=ntp_server)
        return run_session(receiver, band, length_s, state, ctx)

    request = Request(
        sessions=args.sessions,
        hours=args.hours,
        bands=tuple(args.band),
        length_s=None if args.minutes is None else args.minutes * 60,
    )
    try:
        return run_schedule(receivers, request, args.corpus, runner, Clock(), stop)
    except LockError as exc:
        log.error("%s", exc)
        return EXIT_CONFIG
