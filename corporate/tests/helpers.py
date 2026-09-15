"""Shared rig for the corporate tests.

Every test owns a private store folder that it makes and throws away, and the
server runs on a private port — never the one Miles's own preview uses.
"""

import json
import os
import socket
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

CORPORATE = Path(__file__).resolve().parent.parent
if str(CORPORATE) not in sys.path:
    sys.path.insert(0, str(CORPORATE))

FIXTURES = CORPORATE / "fixtures"


def private_port():
    """The port these tests own.  Never 8790, which is Miles's own preview.

    A port we cannot have is a RED test, not a skipped one: a check that
    cannot look refuses, it never answers "fine".
    """
    wanted = int(os.environ.get("CORP_PORT", "8791"))
    if wanted == 8790:
        raise AssertionError("the tests refuse to run on the preview's own port")
    probe = socket.socket()
    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        probe.bind(("127.0.0.1", wanted))
    except OSError as busy:
        raise AssertionError(
            "port %d is already in use, so these tests cannot run: %s. "
            "Stop whatever holds it, or set CORP_PORT to a free one."
            % (wanted, busy))
    finally:
        probe.close()
    return wanted


class StoreCase(unittest.TestCase):
    """A test with its own empty store folder."""

    def setUp(self):
        self._folder = tempfile.TemporaryDirectory(prefix="corp-test-")
        self._was = os.environ.get("CORP_DATA")
        os.environ["CORP_DATA"] = self._folder.name
        import store
        self.store = store
        self.questions = store.load_questions()["questions"]
        store.wipe()

    def tearDown(self):
        if self._was is None:
            os.environ.pop("CORP_DATA", None)
        else:
            os.environ["CORP_DATA"] = self._was
        self._folder.cleanup()

    def fixture(self, name):
        return json.loads((FIXTURES / name).read_text(encoding="utf-8"))

    def plant(self, name="northstar-awards.json"):
        import seed
        return seed.plant(self.fixture(name))


class ServerCase(StoreCase):
    """A StoreCase with the real server answering on a private port."""

    def setUp(self):
        super().setUp()
        import server
        self.port = private_port()
        self.httpd = server.serve(self.port)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.origin = "http://127.0.0.1:%d" % self.port

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        super().tearDown()

    def call(self, path, token=None, body=None, host=None, origin=None,
             method=None, raw=False):
        url = self.origin + path
        payload = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(url, data=payload,
                                         method=method or ("POST" if payload else "GET"))
        request.add_header("Host", host or ("127.0.0.1:%d" % self.port))
        if token:
            request.add_header("X-Access-Token", token)
        if payload is not None:
            request.add_header("Content-Type", "application/json")
        if origin:
            request.add_header("Origin", origin)
        try:
            with urllib.request.urlopen(request, timeout=10) as answer:
                text = answer.read().decode("utf-8")
                return answer.status, (text if raw else json.loads(text))
        except urllib.error.HTTPError as refused:
            with refused:
                text = refused.read().decode("utf-8")
            try:
                return refused.code, json.loads(text)
            except ValueError:
                return refused.code, text
