"""
So sanh nhieu candidate ASR model (WER/CER + latency) tren cung mot test set.

Muc dich: quyet dinh co nen thay whisper-small baseline bang PhoWhisper hay khong,
dua tren so lieu do duoc tren chinh may cua ban, khong doan mo.

Cach dung:
    python eval/benchmark_asr_candidates.py --testset data/asr_testset/manifest.tsv --language vi
    python eval/benchmark_asr_candidates.py --testset data/asr_testset/manifest_en.tsv --language en

File manifest.tsv can co 3 cot, cach nhau bang TAB:
    audio_path	reference_text	language
    data/asr_testset/vi_001.wav	xin chao cac ban	vi
    ...

Luu y quan trong ve doanh sach CANDIDATES ben duoi:
- Ten model PhoWhisper CTranslate2 tren HuggingFace co the doi theo thoi gian /
  theo nguoi convert (repo cong dong, khong phai chinh chu VinAI). HAY tu kiem tra
  lai ten chinh xac tren trang HuggingFace truoc khi chay, vi day la thong tin
  chua duoc xac minh runtime, chi lay tu ket qua tim kiem.
- Neu model can auth hoac khong ton tai, script se in loi cho candidate do va
  van chay tiep cac candidate khac (khong dung ca script).
"""
import argparse
import csv
import time
from datetime import datetime
from pathlib import Path

import jiwer
from faster_whisper import WhisperModel

# TODO: xac nhan lai ten repo PhoWhisper CTranslate2 chinh xac truoc khi chay that.
CANDIDATES_VI = [
    {"label": "whisper-small (baseline, multilingual)", "model": "small", "compute_type": "int8"},
    {
        "label": "PhoWhisper-base (ct2)",
        "model": "quocphu/PhoWhisper-ct2-FasterWhisper",
        "subfolder": "PhoWhisper-base-ct2-fasterWhisper",
        "compute_type": "int8",
    },
    {
        "label": "PhoWhisper-small (ct2)",
        "model": "quocphu/PhoWhisper-ct2-FasterWhisper",
        "subfolder": "PhoWhisper-small-ct2-fasterWhisper",
        "compute_type": "int8",
    },
]

CANDIDATES_EN = [
    {"label": "whisper-small (baseline, multilingual)", "model": "small", "compute_type": "int8"},
    {"label": "whisper-base (baseline, multilingual)", "model": "base", "compute_type": "int8"},
]

CANDIDATES_BY_LANG = {"vi": CANDIDATES_VI, "en": CANDIDATES_EN}


def load_manifest(path: str):
    rows = []
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            rows.append(row)
    if not rows:
        raise ValueError(f"Manifest rong hoac sai dinh dang: {path}")
    return rows


def normalize_text(text: str) -> str:
    # Chuan hoa toi thieu de so sanh cong bang: lower-case, strip khoang trang thua.
    # KHONG xoa dau cau/thanh dieu tieng Viet - de nguyen de WER phan anh dung thuc te.
    return " ".join(text.strip().lower().split())


def benchmark_candidate(candidate: dict, manifest: list, beam_size: int, language: str):
    model_path = candidate["model"]
    if candidate.get("subfolder"):
        from huggingface_hub import snapshot_download

        snapshot = snapshot_download(
            repo_id=candidate["model"],
            allow_patterns=f"{candidate['subfolder']}/*",
        )
        model_path = str(Path(snapshot) / candidate["subfolder"])
    model = WhisperModel(model_path, device="cpu", compute_type=candidate.get("compute_type", "int8"))

    hypotheses, references, latencies_ms = [], [], []
    for row in manifest:
        audio_path = row["audio_path"]
        reference = row["reference_text"]
        row_language = row.get("language") or language

        t0 = time.perf_counter()
        segments, _info = model.transcribe(audio_path, beam_size=beam_size, language=row_language)
        hyp_text = " ".join(seg.text for seg in segments).strip()
        latencies_ms.append((time.perf_counter() - t0) * 1000)

        hypotheses.append(normalize_text(hyp_text))
        references.append(normalize_text(reference))

    wer = jiwer.wer(references, hypotheses)
    cer = jiwer.cer(references, hypotheses)

    latencies_ms.sort()
    p50 = latencies_ms[len(latencies_ms) // 2]
    p95_idx = max(0, int(len(latencies_ms) * 0.95) - 1)
    p95 = latencies_ms[p95_idx]

    return {
        "label": candidate["label"],
        "model": candidate["model"],
        "n_samples": len(manifest),
        "wer": wer,
        "cer": cer,
        "latency_ms_p50": p50,
        "latency_ms_p95": p95,
    }


def print_and_save_results(results: list, language: str, beam_size: int):
    header = "| Model | N | WER | CER | p50 (ms) | p95 (ms) |"
    sep = "|---|---|---|---|---|---|"
    lines = [header, sep]
    for r in results:
        if "error" in r:
            lines.append(f"| {r['label']} | - | LOI | LOI | - | - |")
        else:
            lines.append(
                f"| {r['label']} | {r['n_samples']} | {r['wer']:.2%} | {r['cer']:.2%} "
                f"| {r['latency_ms_p50']:.1f} | {r['latency_ms_p95']:.1f} |"
            )

    print("\n" + "\n".join(lines))

    out_dir = Path("eval")
    out_dir.mkdir(exist_ok=True)
    out_file = out_dir / f"results_asr_candidates_{language}_beam{beam_size}_{datetime.now():%Y%m%d}.md"
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(f"# ASR candidate benchmark ({language}) - {datetime.now():%Y-%m-%d %H:%M}\n\n")
        f.write(f"Beam size: {beam_size}\n\n")
        f.write("\n".join(lines))
        f.write("\n")
    print(f"\nDa ghi ket qua: {out_file}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--testset", required=True, help="Duong dan manifest.tsv")
    parser.add_argument("--language", required=True, choices=["vi", "en"])
    parser.add_argument("--beam-size", type=int, default=1, help="Dung 1 de mo phong partial, 5 de mo phong final")
    args = parser.parse_args()

    manifest = load_manifest(args.testset)
    candidates = CANDIDATES_BY_LANG[args.language]

    results = []
    for candidate in candidates:
        print(f"Benchmarking: {candidate['label']} ...")
        try:
            results.append(benchmark_candidate(candidate, manifest, args.beam_size, args.language))
        except Exception as exc:  # noqa: BLE001 - muon in loi cho tung candidate, khong dung script
            print(f"  LOI voi {candidate['label']}: {exc}")
            results.append({"label": candidate["label"], "error": str(exc)})

    print_and_save_results(results, args.language, args.beam_size)


if __name__ == "__main__":
    main()
