from __future__ import annotations

from pathlib import Path

from src.terminology import TerminologyManager


def test_default_terminology_is_empty() -> None:
    manager = TerminologyManager()

    assert manager.target_terms("khach hang", "vi") == []


def test_vi_glossary_matching_is_accent_insensitive(tmp_path: Path) -> None:
    glossary = tmp_path / "glossary.csv"
    glossary.write_text("vi,en\nkhach hang,customer\nhop dong,contract\n", encoding="utf-8")
    manager = TerminologyManager(glossary)

    assert manager.target_terms("khách hàng ký hợp đồng", "vi") == ["customer", "contract"]
