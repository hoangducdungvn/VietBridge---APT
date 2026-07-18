"""Máy dịch NLLB CTranslate2 CPU INT8."""

from __future__ import annotations

import os
import re
from typing import Any


LANGUAGE_CODES = {"vi": "vie_Latn", "en": "eng_Latn"}


class NLLBTranslator:
    """Nạp model/tokenizer cục bộ khi khởi tạo; cho phép mock trong test."""

    def __init__(self, model_path: str, tokenizer_path: str | None = None, *, translator: Any | None = None, tokenizer: Any | None = None) -> None:
        if translator is not None and tokenizer is not None:
            self.translator, self.tokenizer = translator, tokenizer
            return
        try:
            import ctranslate2
            from transformers import AutoTokenizer
        except ImportError as exc:
            raise RuntimeError("Thiếu ctranslate2/transformers; hãy cài requirements") from exc
        self.translator = ctranslate2.Translator(model_path, device="cpu", compute_type="int8")
        self.tokenizer = AutoTokenizer.from_pretrained(tokenizer_path or model_path, local_files_only=True)

    def translate(self, text: str, source_language: str, target_language: str, forced_terms: list[Any] | None = None) -> str:
        """Dịch một câu và ép token ngôn ngữ đích theo NLLB."""
        if not text:
            return ""
        source_code, target_code = LANGUAGE_CODES[source_language], LANGUAGE_CODES[target_language]
        self.tokenizer.src_lang = source_code
        tokens = self.tokenizer.convert_ids_to_tokens(self.tokenizer.encode(text))
        result = self.translator.translate_batch([tokens], target_prefix=[[target_code]], beam_size=4)
        output_tokens = result[0].hypotheses[0]
        return self.tokenizer.decode(self.tokenizer.convert_tokens_to_ids(output_tokens), skip_special_tokens=True).strip()


class TransformersTranslator:
    """Lazy Hugging Face seq2seq translator for localhost MT smoke tests."""

    DEFAULT_MODELS = {
        ("vi", "en"): "Helsinki-NLP/opus-mt-vi-en",
        ("en", "vi"): "Helsinki-NLP/opus-mt-en-vi",
    }

    def __init__(self, *, local_files_only: bool = True, models: dict[tuple[str, str], str] | None = None) -> None:
        self.local_files_only = local_files_only
        self.models = models or self.DEFAULT_MODELS
        self._loaded: dict[tuple[str, str], tuple[Any, Any]] = {}

    def _load(self, source_language: str, target_language: str) -> tuple[Any, Any]:
        key = (source_language, target_language)
        if key in self._loaded:
            return self._loaded[key]
        model_name = self.models.get(key)
        if not model_name:
            raise RuntimeError(f"No MT model configured for {source_language}->{target_language}")
        try:
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        except ImportError as exc:
            raise RuntimeError("Missing transformers; install requirements.txt") from exc
        if self.local_files_only:
            os.environ.setdefault("HF_HUB_OFFLINE", "1")
            os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        tokenizer = AutoTokenizer.from_pretrained(model_name, local_files_only=self.local_files_only)
        model = AutoModelForSeq2SeqLM.from_pretrained(
            model_name,
            local_files_only=self.local_files_only,
            use_safetensors=False,
        )
        model.eval()
        self._loaded[key] = (tokenizer, model)
        return tokenizer, model

    def _target_terms(self, forced_terms: list[Any] | None) -> list[str]:
        targets: list[str] = []
        for term in forced_terms or []:
            if isinstance(term, tuple) and len(term) == 2:
                targets.append(str(term[1]))
            else:
                targets.append(str(term))
        return [term for term in targets if term]

    def _apply_glossary_hints(self, text: str, forced_terms: list[Any] | None) -> str:
        """Pre-replace matched source phrases with target terms before seq2seq MT."""

        rewritten = text
        for term in forced_terms or []:
            if not (isinstance(term, tuple) and len(term) == 2):
                continue
            source, target = str(term[0]), str(term[1])
            if not source or not target:
                continue
            rewritten = re.sub(rf"(?<!\w){re.escape(source)}(?!\w)", target, rewritten, flags=re.IGNORECASE)
        return rewritten

    def _restore_missing_terms(self, translation: str, forced_terms: list[Any] | None) -> str:
        """Ensure matched glossary targets are visible in the final translation."""

        restored = translation
        for target in self._target_terms(forced_terms):
            if not re.search(rf"(?<!\w){re.escape(target)}(?!\w)", restored, re.IGNORECASE):
                restored = f"{restored} ({target})" if restored else target
        return restored

    def translate(self, text: str, source_language: str, target_language: str, forced_terms: list[Any] | None = None) -> str:
        """Translate one final transcript with deterministic glossary post-checks."""
        if not text:
            return ""
        tokenizer, model = self._load(source_language, target_language)
        glossary_text = self._apply_glossary_hints(text, forced_terms)
        inputs = tokenizer(glossary_text, return_tensors="pt", truncation=True, max_length=256)
        outputs = model.generate(**inputs, max_new_tokens=256, num_beams=4)
        translation = tokenizer.decode(outputs[0], skip_special_tokens=True).strip()
        return self._restore_missing_terms(translation, forced_terms)
