# VietBridge — Real-Time VI↔EN Meeting Translator

> Trợ lý phiên dịch thời gian thực cho họp trực tiếp giữa đoàn Việt Nam và Singapore.
> Prototype 2 ngày cho AI Hackathon — chạy **100% offline/on-premise** bằng open-source models.

---

## 🎯 Bài toán

Cuộc họp business VN↔SG cần dịch hai chiều Việt–Anh với độ trễ gần bằng 0, không gián đoạn hội thoại, và bảo mật nội dung nhạy cảm (không đưa audio lên cloud). Hệ thống đặt giữa bàn họp, tự nghe – tự nhận diện ngôn ngữ – tự dịch, **không ai phải bấm nút**.

## ✨ Tính năng chính

- **Zero-touch:** VAD + language ID tự động phát hiện lượt nói và chiều dịch (VI→EN / EN→VI)
- **Phụ đề sống:** partial text hiện ngay khi đang nói, bản dịch stream token-by-token
- **Context-aware translation:** dịch theo ngữ cảnh 3–5 lượt hội thoại + glossary thuật ngữ business
- **TTS hai chiều:** giọng đọc tự nhiên (Piper), có thể tắt để chạy text-only
- **Chống ồn:** denoise trước ASR, hoạt động trong môi trường họp thực tế
- **100% offline:** toàn bộ model chạy local — demo "rút WiFi" vẫn chạy
- **Extensible:** thêm ngôn ngữ mới chỉ bằng sửa file config
- **Manual mode fallback:** nút gạt push-to-talk khi môi trường quá ồn

## 🏗️ Kiến trúc

```
Mic (browser) ──WebSocket──▶ Backend (FastAPI)
   │
   ▼
[Denoise] ─▶ [Silero VAD] ─┬─ đang nói ──▶ [ASR partial] ─▶ UI (phụ đề mờ)
                           └─ hết lượt ──▶ [ASR final] ─▶ [Language ID]
                                                │
                                ┌───────────────┴───────────────┐
                                ▼                               ▼
                          VI detected                     EN detected
                                │                               │
                      [MT vi→en + context]           [MT en→vi + context]
                                │                               │
                                ▼                               ▼
                     UI EN view + TTS EN              UI VN view + TTS VI
```

## 🧰 Tech Stack

| Tầng | Công nghệ | Ghi chú |
|------|-----------|---------|
| VAD | Silero VAD | Phát hiện start/end lượt nói, endpoint ~500–800ms im lặng |
| Denoise | RNNoise / DeepFilterNet | Bật/tắt được |
| ASR | faster-whisper (`medium`, int8) / PhoWhisper | 16kHz mono PCM, partial + final |
| Language ID | Whisper built-in | Detect trên 1–2s đầu lượt nói |
| MT | VinAI Translate (baseline) / Qwen2.5-7B local | Context 3–5 lượt + glossary inject |
| TTS | Piper (VI & EN) | Queue phát, ngắt khi có speech mới |
| Backend | Python + FastAPI + WebSocket | Orchestration + latency metrics |
| Frontend | Web app (2 view VN/EN) | Phụ đề partial→final, QR join qua LAN |

## 📁 Cấu trúc repo (đề xuất)

```
bridgetalk/
├── README.md
├── requirements.txt
├── config.yaml              # languages, models, đường dẫn glossary
├── glossary.txt             # thuật ngữ business nạp trước cuộc họp
├── backend/
│   ├── main.py              # FastAPI + WebSocket orchestration
│   ├── asr_service.py       # ASR: audio clean -> text + language
│   ├── vad_service.py       # Silero VAD + denoise + chunking
│   ├── mt_service.py        # Dịch VI<->EN, context + glossary
│   ├── tts_service.py       # Piper TTS + audio queue
│   └── metrics.py           # Đo latency end-to-end từng tầng
├── frontend/
│   └── index.html           # UI 2 view, mic capture, WebSocket client
├── models/                  # Model weights tải về local (gitignore)
└── tests/
    ├── audio_samples/       # ~10 câu business VI/EN làm test set cố định
    └── test_pipeline.py
```

## 🚀 Cài đặt & chạy

### Yêu cầu
- Python 3.10+
- GPU NVIDIA (khuyến nghị) hoặc CPU (dùng int8, model `small`/`medium`)
- ~8GB RAM trở lên

### Bước 1 — Cài dependencies
```bash
git clone <repo-url> && cd bridgetalk
pip install -r requirements.txt
# requirements chính: faster-whisper, silero-vad, fastapi, uvicorn,
#                     websockets, numpy, piper-tts, transformers
```

### Bước 2 — Tải model về local (làm 1 lần, cần internet)
```bash
python scripts/download_models.py
# Sau bước này hệ thống chạy hoàn toàn offline
```

### Bước 3 — Cấu hình
```yaml
# config.yaml
languages: [vi, en]        # thêm ngôn ngữ mới tại đây
asr_model: medium
mt_backend: vinai          # vinai | llm
glossary: glossary.txt
tts_enabled: true
```

### Bước 4 — Chạy
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
# Mở http://<ip-laptop>:8000 trên trình duyệt
# Thiết bị thứ 2 (tablet/điện thoại) join cùng LAN qua QR trên màn hình
```

### Test nhanh module ASR riêng
```bash
python backend/asr_service.py tests/audio_samples/test_vi.wav
```

## 📊 Mục tiêu hiệu năng (demo day)

| Metric | Target |
|--------|--------|
| Partial text xuất hiện | ≤ 500ms sau khi bắt đầu nói |
| End-of-speech → bản dịch final | ≤ 2s |
| Hội thoại free-flow liên tục | ≥ 15 phút không crash |
| Dịch đúng thuật ngữ glossary | ≥ 90% |
| Internet ở runtime | 0 request |

## 👥 Team (6 người)

| Người | Vai trò | Own |
|-------|---------|-----|
| P1 | Speech pipeline | Mic, VAD, denoise, chunking |
| P2 | Translation | MT models, context, glossary, config đa ngôn ngữ |
| P3 | ASR | Audio clean → text + language ID, partial/final |
| P4 | Backend/Integration | WebSocket, orchestration, latency metrics |
| P5 | Frontend/UX | UI 2 view, phụ đề sống, QR join |
| P6 | QA/Demo/Deploy | Test noise, TTS, kịch bản demo, pitch |

## 🗺️ Roadmap 2 ngày

- **Ngày 1 sáng:** pipeline E2E "xấu nhưng chạy" (thu âm → text dịch hiện màn hình)
- **Ngày 1 chiều:** streaming VAD tự động, partial results, TTS, đo latency
- **Ngày 2 sáng:** denoise + test phòng ồn, manual mode fallback, polish UI — **freeze 12h**
- **Ngày 2 chiều:** tập demo ≥5 lần, pitch deck, video backup

## 📝 Ghi chú

- **Multi-speaker (>2 người):** hỗ trợ nhiều người tham dự nói lần lượt; speaker diarization (pyannote/WhisperX) là stretch goal — xem US-010 trong PRD. Overlap speech ngoài phạm vi prototype.
- **Bonus points nhắm tới:** on-premise open models ✅ · edge-capable (CPU int8) ✅ · noise robustness ✅ · turn-taking tự động ✅ · extensible sang ngôn ngữ low-resource (Thái/Khmer qua config) ✅
- Tài liệu chi tiết: xem `docs/brief-prd-workflow.md`

## 📄 License

Prototype hackathon — mã nguồn nội bộ team, models theo license gốc của từng bên (Whisper/MIT, VinAI/GPL, Piper/MIT, Silero/MIT).