import logging
import time

import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

from app.schemas import ContextTurnSchema

logger = logging.getLogger("translation-service")

MODEL_NAME = "facebook/nllb-200-distilled-600M"

LANG_MAP = {
    "vi": "vie_Latn",
    "en": "eng_Latn",
}


class NLLBTranslator:
    def __init__(self, model_name: str = MODEL_NAME):
        self.model_name = model_name
        self.tokenizer: AutoTokenizer | None = None
        self.model: AutoModelForSeq2SeqLM | None = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.loaded = False
        self.last_latency_ms = 0

    def load_model(self) -> None:
        if self.loaded:
            return

        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(self.model_name).to(self.device)
        self.loaded = True

    def translate(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        context: list[ContextTurnSchema] | None = None,
        glossary: dict[str, str] | None = None,
    ) -> str:
        if text is None or not isinstance(text, str) or not text.strip():
            raise ValueError("Input text must be a non-empty string")

        if not self.loaded or self.tokenizer is None or self.model is None:
            raise RuntimeError("NLLB-200 model is not loaded")

        src_code = LANG_MAP.get(source_lang)
        tgt_code = LANG_MAP.get(target_lang)

        if not src_code or not tgt_code:
            raise ValueError(f"Unsupported language pair: {source_lang} -> {target_lang}")

        if context:
            logger.info("Received %d context turns for audit/debug; not injecting into NLLB-200 input.", len(context))
        if glossary:
            logger.info("Received glossary with %d entries for audit/debug; not injecting into NLLB-200 input.", len(glossary))
        # TODO: NLLB-200 is a sentence-level seq2seq translation model, not a prompt-following LLM.
        # Keep context/glossary out of the model input unless we have a translation-specific strategy
        # that preserves grammar and alignment reliably.

        start_time = time.perf_counter()

        self.tokenizer.src_lang = src_code
        inputs = self.tokenizer(text, return_tensors="pt").to(self.device)
        forced_bos_token_id = self.tokenizer.convert_tokens_to_ids(tgt_code)

        with torch.no_grad():
            translated_tokens = self.model.generate(
                **inputs,
                forced_bos_token_id=forced_bos_token_id,
                max_new_tokens=128,
                num_beams=4,
            )

        result = self.tokenizer.batch_decode(translated_tokens, skip_special_tokens=True)[0]
        self.last_latency_ms = int((time.perf_counter() - start_time) * 1000)
        return result


translator = NLLBTranslator()
