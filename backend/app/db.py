"""
SQLite persistence layer for the panel and inverter catalogs.

Uses stdlib sqlite3 — no additional dependencies required.
DB file location is configurable via the DB_PATH environment variable.
"""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = os.getenv(
    "DB_PATH",
    str(Path(__file__).parent.parent / "data" / "panels.db"),
)

_CREATE_PANELS = """
CREATE TABLE IF NOT EXISTS panels (
    id               TEXT PRIMARY KEY,
    constructor      TEXT NOT NULL,
    model            TEXT NOT NULL,
    power_w          REAL NOT NULL,
    efficiency_pct   REAL NOT NULL,
    width_m          REAL NOT NULL,
    height_m         REAL NOT NULL,
    weight_kg        REAL,
    op_temperature_c TEXT,
    temp_coefficient REAL,
    warranty_years   INTEGER,
    degradation_pct  REAL
);
"""

_CREATE_INVERTERS = """
CREATE TABLE IF NOT EXISTS inverters (
    id                  TEXT PRIMARY KEY,
    constructor         TEXT NOT NULL,
    model               TEXT NOT NULL,
    power_kw            REAL NOT NULL,
    max_dc_power_kw     REAL NOT NULL,
    mppt_channels       INTEGER NOT NULL,
    mppt_voltage_min_v  REAL NOT NULL,
    mppt_voltage_max_v  REAL NOT NULL,
    max_input_voltage_v REAL NOT NULL,
    max_input_current_a REAL NOT NULL,
    efficiency_pct      REAL NOT NULL,
    weight_kg           REAL,
    warranty_years      INTEGER
);
"""

# Colonne aggiunte alla tabella panels (migrazione idempotente)
_PANELS_NEW_COLUMNS = [
    ("voc_v", "REAL"),
    ("isc_a", "REAL"),
    ("vmpp_v", "REAL"),
    ("impp_a", "REAL"),
    ("temp_coeff_voc", "REAL"),
    ("temp_coeff_isc", "REAL"),
]


def _migrate_panels(con: sqlite3.Connection) -> None:
    """Add new electrical columns to panels table (idempotent)."""
    for col_name, col_type in _PANELS_NEW_COLUMNS:
        try:
            con.execute(f"ALTER TABLE panels ADD COLUMN {col_name} {col_type}")
        except sqlite3.OperationalError:
            pass  # Column already exists


def init_db() -> None:
    """Create tables and run migrations."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    try:
        con.execute(_CREATE_PANELS)
        con.execute(_CREATE_INVERTERS)
        _migrate_panels(con)
        con.commit()
    finally:
        con.close()


def get_connection() -> sqlite3.Connection:
    """Return a connection with Row factory enabled."""
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


@contextmanager
def get_db():
    """Context manager that yields a connection and closes it on exit."""
    con = get_connection()
    try:
        yield con
    finally:
        con.close()
