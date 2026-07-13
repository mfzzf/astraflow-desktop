#!/usr/bin/env python3
"""Small socat-compatible bridge for Anthropic Sandbox Runtime on Linux.

Only the two relay forms emitted by @anthropic-ai/sandbox-runtime are
implemented: UNIX-LISTEN -> TCP and TCP-LISTEN -> UNIX-CONNECT. Keeping this
adapter in-tree avoids depending on a host-installed socat executable.
"""

from __future__ import annotations

import os
import selectors
import signal
import socket
import sys
import threading
from dataclasses import dataclass


@dataclass(frozen=True)
class Endpoint:
    family: int
    address: str | tuple[str, int]
    listen: bool


def parse_endpoint(raw: str) -> Endpoint:
    value = raw.split(",", 1)[0]

    if value.startswith("UNIX-LISTEN:"):
        return Endpoint(socket.AF_UNIX, value.removeprefix("UNIX-LISTEN:"), True)

    if value.startswith("UNIX-CONNECT:"):
        return Endpoint(socket.AF_UNIX, value.removeprefix("UNIX-CONNECT:"), False)

    if value.startswith("TCP-LISTEN:"):
        port = int(value.removeprefix("TCP-LISTEN:"))
        return Endpoint(socket.AF_INET, ("127.0.0.1", port), True)

    if value.startswith("TCP:"):
        host, raw_port = value.removeprefix("TCP:").rsplit(":", 1)
        return Endpoint(socket.AF_INET, (host, int(raw_port)), False)

    raise ValueError(f"Unsupported bridge endpoint: {raw}")


def connect(endpoint: Endpoint) -> socket.socket:
    peer = socket.socket(endpoint.family, socket.SOCK_STREAM)
    peer.connect(endpoint.address)
    return peer


def relay(left: socket.socket, right: socket.socket) -> None:
    selector = selectors.DefaultSelector()
    selector.register(left, selectors.EVENT_READ, right)
    selector.register(right, selectors.EVENT_READ, left)

    try:
        while selector.get_map():
            for key, _ in selector.select():
                source = key.fileobj
                destination = key.data

                try:
                    data = source.recv(64 * 1024)
                except OSError:
                    data = b""

                if data:
                    destination.sendall(data)
                    continue

                selector.unregister(source)

                try:
                    destination.shutdown(socket.SHUT_WR)
                except OSError:
                    pass
    finally:
        selector.close()
        left.close()
        right.close()


def serve(listener_endpoint: Endpoint, target_endpoint: Endpoint) -> None:
    if not listener_endpoint.listen or target_endpoint.listen:
        raise ValueError("Expected a listener endpoint followed by a target endpoint")

    unix_path = (
        listener_endpoint.address
        if listener_endpoint.family == socket.AF_UNIX
        else None
    )

    if isinstance(unix_path, str):
        try:
            os.unlink(unix_path)
        except FileNotFoundError:
            pass

    listener = socket.socket(listener_endpoint.family, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(listener_endpoint.address)
    listener.listen(128)
    listener.settimeout(0.5)
    stopping = threading.Event()

    def stop(_signum: int, _frame: object) -> None:
        stopping.set()
        listener.close()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    try:
        while not stopping.is_set():
            try:
                client, _ = listener.accept()
            except TimeoutError:
                continue
            except OSError:
                if stopping.is_set():
                    break
                raise

            try:
                target = connect(target_endpoint)
            except OSError:
                client.close()
                continue

            threading.Thread(
                target=relay,
                args=(client, target),
                daemon=True,
            ).start()
    finally:
        try:
            listener.close()
        except OSError:
            pass

        if isinstance(unix_path, str):
            try:
                os.unlink(unix_path)
            except FileNotFoundError:
                pass


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(
            "Usage: socat-bridge.py <listen-endpoint> <target-endpoint>"
        )

    serve(parse_endpoint(sys.argv[1]), parse_endpoint(sys.argv[2]))


if __name__ == "__main__":
    main()
