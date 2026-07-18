from __future__ import annotations

from src.mt import LANGUAGE_CODES


def test_language_codes_cover_vi_en() -> None:
    assert LANGUAGE_CODES["vi"] == "vie_Latn"
    assert LANGUAGE_CODES["en"] == "eng_Latn"
