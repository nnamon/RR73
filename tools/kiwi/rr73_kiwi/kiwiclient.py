"""kiwiclient's protocol module, imported without the kiwi package's __init__.py.

kiwi/__init__.py also imports kiwi.worker, kiwi.rigctld (GPL-2.0-or-later) and kiwi.wavreader,
none of which rr73-kiwi uses. Registering an empty kiwi package first means only kiwi.client,
kiwi.wsclient and the bundled mod_pywebsocket (BSD-3-Clause) are loaded.
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
import types


def _load_client() -> types.ModuleType:
    if "kiwi" not in sys.modules:
        spec = importlib.util.find_spec("kiwi")
        if spec is None or spec.submodule_search_locations is None:
            raise ImportError(
                "kiwiclient is missing: /opt/kiwiclient must be on PYTHONPATH (see tools/kiwi/Dockerfile)"
            )
        package = types.ModuleType("kiwi")
        package.__path__ = list(spec.submodule_search_locations)
        sys.modules["kiwi"] = package
    return importlib.import_module("kiwi.client")


client = _load_client()
