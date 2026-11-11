"""Asset import safety and canonical seed consistency."""

from collections import Counter
from pathlib import Path
import re

import pytest

from scripts.upload_challenge_assets import plan_assets


def test_asset_plan_resolves_challenge_numbers(tmp_path):
    photo = tmp_path / "challenge13.jpg"
    photo.write_bytes(b"photo")
    assert plan_assets(tmp_path, [{"id": "pose", "sort_order": 13}]) == [(photo, "pose")]


@pytest.mark.parametrize("rows", [[], [{"id": "a", "sort_order": 2}, {"id": "b", "sort_order": 2}]])
def test_asset_plan_rejects_missing_or_ambiguous_challenge(tmp_path, rows):
    (tmp_path / "challenge2.jpg").write_bytes(b"photo")
    with pytest.raises(ValueError, match="exactly one"):
        plan_assets(tmp_path, rows)


@pytest.mark.parametrize("name,data", [("challenge02.jpg", b"photo"), ("challenge2.jpg", b"")])
def test_asset_plan_rejects_invalid_files(tmp_path, name, data):
    (tmp_path / name).write_bytes(data)
    with pytest.raises(ValueError):
        plan_assets(tmp_path, [{"id": "a", "sort_order": 2}])


def test_asset_plan_rejects_empty_folder(tmp_path):
    with pytest.raises(ValueError, match="no challenge"):
        plan_assets(tmp_path, [])


def test_seed_matches_current_canonical_content():
    root = Path(__file__).resolve().parents[2]
    expected = []
    for line in (root / "challenges/challenges.md").read_text(encoding="utf-8").splitlines():
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) == 6 and cells[0].isdigit():
            expected.append(cells)
    seed = (root / "backend/supabase/seed_challenges.sql").read_text(encoding="utf-8")
    inserted = [line for line in seed.splitlines() if line.strip().startswith("(v_session,")]
    assert len(inserted) == len(expected) == 29
    for line, (number, tier, title, area, condition, image) in zip(inserted, expected):
        literals = [value.replace("''", "'") for value in re.findall(r"'((?:[^']|'')*)'", line)]
        assert literals[:4] == [title, area, condition, f"tier{tier}"]
        assert f", {number}, " in line
        assert literals[4:] == ([] if image == "-" else ["/" + image.strip("`")])
    assert Counter(row[1] for row in expected) == {"1": 10, "2": 12, "3": 7}
    assert "{{phone}}" in seed
    assert "is_active" not in seed
