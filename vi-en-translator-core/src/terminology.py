"""Glossary lookup helpers for Vietnamese-English terminology forcing."""

from __future__ import annotations

import csv
import re
import unicodedata
from pathlib import Path


class TerminologyManager:
    """Load a two-column vi/en glossary and match entries by word boundaries."""

    def __init__(self, glossary_path: str | Path | None = None) -> None:
        self.entries: list[tuple[str, str]] = []
        if glossary_path and Path(glossary_path).exists():
            with Path(glossary_path).open(encoding="utf-8-sig", newline="") as file:
                for row in csv.DictReader(file):
                    if row.get("vi") and row.get("en"):
                        self.entries.append((row["vi"].strip(), row["en"].strip()))

    def target_terms(self, text: str, source_language: str) -> list[str]:
        """Return target glossary terms matched in the source text."""

        return [target for _, target in self.term_pairs(text, source_language)]

    def _normalize(self, text: str) -> str:
        decomposed = unicodedata.normalize("NFD", text)
        without_marks = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
        return without_marks.replace("đ", "d").replace("Đ", "D").lower()

    def term_pairs(self, text: str, source_language: str) -> list[tuple[str, str]]:
        """Return matched source->target glossary pairs, longest source phrases first."""

        source_index, target_index = (0, 1) if source_language == "vi" else (1, 0)
        normalized_text = self._normalize(text)
        matches: list[tuple[str, str]] = []
        for pair in sorted(self.entries, key=lambda item: len(item[source_index]), reverse=True):
            normalized_source = self._normalize(pair[source_index])
            if re.search(rf"(?<!\w){re.escape(normalized_source)}(?!\w)", normalized_text, re.IGNORECASE):
                matches.append((pair[source_index], pair[target_index]))
        return matches
