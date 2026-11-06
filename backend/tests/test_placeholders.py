"""Placeholder substitution for deploy-time values.

The host's contact number lives in ``CONTACT_PHONE`` rather than in the seeded
challenge text, so these tests pin both the substitution and the readable
fallback players see when the variable is unset.
"""

from __future__ import annotations

import pytest

from app.config import get_settings
from app.snapshots import PHONE_FALLBACK, fill_placeholders


@pytest.fixture(autouse=True)
def _fresh_settings():
    """Drop the cached Settings so each test sees its own environment."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_phone_is_substituted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONTACT_PHONE", "91234567")
    assert fill_placeholders("call Sean at {{phone}}.") == "call Sean at 91234567."


def test_phone_is_trimmed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONTACT_PHONE", "  91234567  ")
    assert fill_placeholders("{{phone}}") == "91234567"


def test_phone_falls_back_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONTACT_PHONE", "")
    assert fill_placeholders("call Sean at {{phone}}.") == (
        f"call Sean at {PHONE_FALLBACK}."
    )


def test_text_without_the_token_is_untouched() -> None:
    assert fill_placeholders("no token here") == "no token here"
    assert fill_placeholders(None) is None
