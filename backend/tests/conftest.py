import os
import tempfile

import pytest
from httpx import AsyncClient, ASGITransport

# Use a temporary DB for tests so we don't pollute the real catalog.
_tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["DB_PATH"] = _tmp_db.name

from app.main import app  # noqa: E402 — must import after DB_PATH override
from app.db import init_db  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _setup_db():
    """Create tables once for the whole test session."""
    init_db()
    yield
    # Cleanup temp file
    try:
        os.unlink(_tmp_db.name)
    except OSError:
        pass


@pytest.fixture
async def async_client():
    """Shared async HTTP client for all test modules."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


# ─── Minimal OBJ cube (8 vertices, 6 faces) ────────────────

_CUBE_OBJ = """\
v -0.5 0.0 -0.5
v  0.5 0.0 -0.5
v  0.5 1.0 -0.5
v -0.5 1.0 -0.5
v -0.5 0.0  0.5
v  0.5 0.0  0.5
v  0.5 1.0  0.5
v -0.5 1.0  0.5
f 1 2 3 4
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
"""


@pytest.fixture
def cube_obj_bytes() -> bytes:
    """Return a valid OBJ file as bytes (unit cube, 1×1×1 m)."""
    return _CUBE_OBJ.encode()


# ─── Sample panel payload ───────────────────────────────────

@pytest.fixture
def sample_panel_payload() -> dict:
    return {
        "constructor": "TestCorp",
        "model": "TC-400",
        "power_w": 400,
        "efficiency_pct": 21.0,
        "width_m": 1.0,
        "height_m": 1.7,
    }
