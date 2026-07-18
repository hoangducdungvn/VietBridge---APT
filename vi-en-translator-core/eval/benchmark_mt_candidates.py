"""
So sanh cac MT candidate (BLEU/chrF + latency) tren cung mot test set song ngu.

Muc dich: quyet dinh co nen thay NLLB-200-distilled-600M bang VinAI Translate
(vinai-translate-vi2en / vinai-translate-envi) hay khong, dua tren so lieu do
duoc tren chinh may cua ban.

Cach dung:
    python eval/benchmark_mt_candidates.py --testset data/test_scenarios.tsv --direction vi2en
    python eval/benchmark_mt_candidates.py --testset data/test_scenarios.tsv --direction en2vi

QUAN TRONG - kiem tra truoc khi chay:
- File data/test_scenarios.tsv hien co cua ban co the KHONG dung dung ten cot
  gia dinh ben duoi (source_vi/target_en, source_en/target_vi). Mo file len
  kiem tra ten cot that su, roi sua bien src_col/tgt_col trong ham load_pairs()
  cho khop, hoac doi ten cot trong file cho khop voi script.
- vinai/vinai-translate-vi2en va vinai/vinai-translate-envi la 2 model MBart
  RIENG BIET theo tung chieu (khac NLLB dung 1 model + language code cho ca
  2 chieu) - vi vay script nay load model khac nhau tuy --direction.
"""
import argparse
import csv
import time
from datetime import datetime
from pathlib import Path

import sacrebleu

CANDIDATES_BY_DIRECTION = {
    "vi2en": [
        {
            "label": "NLLB-200-distilled-600M (baseline, spec goc)",
            "backend": "nllb",
            "model": "facebook/nllb-200-distilled-600M",
            "src_code": "vie_Latn",
            "tgt_code": "eng_Latn",
        },
        {
            "label": "VinAI Translate vi2en",
            "backend": "vinai",
            "model": "vinai/vinai-translate-vi2en",
        },
    ],
    "en2vi": [
        {
            "label": "NLLB-200-distilled-600M (baseline, spec goc)",
            "backend": "nllb",
            "model": "facebook/nllb-200-distilled-600M",
            "src_code": "eng_Latn",
            "tgt_code": "vie_Latn",
        },
        {
            "label": "VinAI Translate envi",
            "backend": "vinai",
            "model": "vinai/vinai-translate-envi",
        },
    ],
}


def load_pairs(path: str, direction: str):
    # Schema co dinh: file TSV phai co 2 cot "vi_text" va "en_text" (vd: test_scenarios_sample.tsv).
    # direction quyet dinh cot nao la source, cot nao la reference - khong doi ten cot theo direction.
    src_col, tgt_col = ("vi_text", "en_text") if direction == "vi2en" else ("en_text", "vi_text")
    pairs = []
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            if src_col not in row or tgt_col not in row:
                raise KeyError(
                    f"Khong tim thay cot '{src_col}' hoac '{tgt_col}' trong {path}. "
                    f"Cot hien co: {list(row.keys())}. File can co dung 2 cot 'vi_text' va 'en_text'."
                )
            if not row[src_col].strip() or not row[tgt_col].strip():
                continue  # bo qua dong thieu du lieu (vd row chi co source, khong co reference)
            pairs.append((row[src_col], row[tgt_col]))
    if len(pairs) < 10:
        raise ValueError(
            f"Test set chi co {len(pairs)} cap cau hop le trong {path} (can >= 10 de so lieu dang tin). "
            f"Bo sung them du lieu truoc khi benchmark."
        )
    return pairs


def load_nllb(model_id: str):
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_id)
    model.eval()
    return tokenizer, model


def translate_nllb(tokenizer, model, text: str, src_code: str, tgt_code: str) -> str:
    tokenizer.src_lang = src_code
    encoded = tokenizer(text, return_tensors="pt")
    forced_bos_token_id = tokenizer.convert_tokens_to_ids(tgt_code)
    generated = model.generate(**encoded, forced_bos_token_id=forced_bos_token_id, max_new_tokens=128)
    return tokenizer.batch_decode(generated, skip_special_tokens=True)[0]


def load_vinai(model_id: str):
    from transformers import AutoTokenizer, MBartForConditionalGeneration

    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = MBartForConditionalGeneration.from_pretrained(model_id)
    model.eval()
    return tokenizer, model


def translate_vinai(tokenizer, model, text: str) -> str:
    encoded = tokenizer(text, return_tensors="pt")
    generated = model.generate(**encoded, max_new_tokens=128, num_beams=5, early_stopping=True)
    return tokenizer.batch_decode(generated, skip_special_tokens=True)[0]


def benchmark_candidate(candidate: dict, pairs: list):
    sources = [p[0] for p in pairs]
    references = [p[1] for p in pairs]
    hypotheses, latencies_ms = [], []

    if candidate["backend"] == "nllb":
        tokenizer, model = load_nllb(candidate["model"])
        for text in sources:
            t0 = time.perf_counter()
            hyp = translate_nllb(tokenizer, model, text, candidate["src_code"], candidate["tgt_code"])
            latencies_ms.append((time.perf_counter() - t0) * 1000)
            hypotheses.append(hyp)
    elif candidate["backend"] == "vinai":
        tokenizer, model = load_vinai(candidate["model"])
        for text in sources:
            t0 = time.perf_counter()
            hyp = translate_vinai(tokenizer, model, text)
            latencies_ms.append((time.perf_counter() - t0) * 1000)
            hypotheses.append(hyp)
    else:
        raise ValueError(f"Backend khong ro: {candidate['backend']}")

    bleu = sacrebleu.corpus_bleu(hypotheses, [references])
    chrf = sacrebleu.corpus_chrf(hypotheses, [references])

    latencies_ms.sort()
    p50 = latencies_ms[len(latencies_ms) // 2]
    p95_idx = max(0, int(len(latencies_ms) * 0.95) - 1)
    p95 = latencies_ms[p95_idx]

    return {
        "label": candidate["label"],
        "n_samples": len(pairs),
        "bleu": bleu.score,
        "chrf": chrf.score,
        "latency_ms_p50": p50,
        "latency_ms_p95": p95,
    }


def print_and_save_results(results: list, direction: str):
    header = "| Model | N | BLEU | chrF | p50 (ms) | p95 (ms) |"
    sep = "|---|---|---|---|---|---|"
    lines = [header, sep]
    for r in results:
        if "error" in r:
            lines.append(f"| {r['label']} | - | LOI | LOI | - | - |")
        else:
            lines.append(
                f"| {r['label']} | {r['n_samples']} | {r['bleu']:.2f} | {r['chrf']:.2f} "
                f"| {r['latency_ms_p50']:.1f} | {r['latency_ms_p95']:.1f} |"
            )

    print("\n" + "\n".join(lines))

    out_dir = Path("eval")
    out_dir.mkdir(exist_ok=True)
    out_file = out_dir / f"results_mt_candidates_{direction}_{datetime.now():%Y%m%d}.md"
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(f"# MT candidate benchmark ({direction}) - {datetime.now():%Y-%m-%d %H:%M}\n\n")
        f.write("\n".join(lines))
        f.write("\n")
    print(f"\nDa ghi ket qua: {out_file}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--testset", required=True, help="Duong dan file TSV song ngu (vd: data/test_scenarios.tsv)")
    parser.add_argument("--direction", choices=["vi2en", "en2vi"], required=True)
    args = parser.parse_args()

    pairs = load_pairs(args.testset, args.direction)
    candidates = CANDIDATES_BY_DIRECTION[args.direction]

    results = []
    for candidate in candidates:
        print(f"Benchmarking: {candidate['label']} ...")
        try:
            results.append(benchmark_candidate(candidate, pairs))
        except Exception as exc:  # noqa: BLE001 - muon in loi cho tung candidate, khong dung script
            print(f"  LOI voi {candidate['label']}: {exc}")
            results.append({"label": candidate["label"], "error": str(exc)})

    print_and_save_results(results, args.direction)


if __name__ == "__main__":
    main()
