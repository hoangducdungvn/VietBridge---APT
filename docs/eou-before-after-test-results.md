# Số liệu hệ thống trước và sau khi thêm EOU

## 1. Phạm vi và cách đọc kết quả

Tài liệu này tách rõ hai loại số liệu:

- **Số liệu đo tự động:** chạy trực tiếp thuật toán EOU trên audio tổng hợp 16 kHz mono, mỗi trường hợp gồm 1500 ms giọng nói và một khoảng im lặng xác định.
- **Số liệu quan sát thực tế:** transcript Live Actor do người dùng cung cấp trước thay đổi. Log này không có audio gốc và timestamp `turn.end`, vì vậy không thể tính WER hoặc so sánh latency trước/sau một cách hợp lệ.

Ngày đo: 18/07/2026. Lệnh chạy tại thư mục `stt`, dùng Python và NumPy trong môi trường dự án. Mỗi phép đo thời gian EOU được lặp 200 lần; bảng dưới ghi mean và p95 của từng kịch bản. Không gọi FPT/Groq trong phép đo này, nên số liệu không bao gồm network hoặc ASR latency.

## 2. Cấu hình so sánh

| Nhóm | Trước | Sau |
|---|---:|---:|
| Client EOU `endSilenceMs` | 600 ms | 1000 ms |
| Client `speechEndThreshold` | 0.28 | 0.22 |
| Client `maxUtteranceMs` | 20000 ms | 25000 ms |
| Silero VAD trên frontend | Tắt | Bật |
| STT EOU metadata | Không có | Có |
| Bộ lọc transcript lặp | Không có signal lặp | Có signal lặp token/câu |

Lưu ý: benchmark A/B dưới đây cô lập riêng tác động của `endSilenceMs` 600 và 1000 ms. Nó không tuyên bố đo chất lượng của Silero hoặc độ chính xác ASR.

## 3. Kết quả từng lượt test ranh giới EOU

### T1 - Khoảng nghỉ 500 ms

| Cấu hình | Endpoint | Lý do | Speech | Im lặng cuối | Tổng audio | Mean | p95 |
|---|---|---|---:|---:|---:|---:|---:|
| Trước, 600 ms | Không | `speaking` | 1500 ms | 500 ms | 2000 ms | 1.599 ms | 2.134 ms |
| Sau, 1000 ms | Không | `speaking` | 1500 ms | 500 ms | 2000 ms | 1.608 ms | 2.221 ms |

Kết luận: cả hai cấu hình đều giữ turn; không có khác biệt hành vi.

### T2 - Khoảng nghỉ 600 ms

| Cấu hình | Endpoint | Lý do | Speech | Im lặng cuối | Tổng audio | Mean | p95 |
|---|---|---|---:|---:|---:|---:|---:|
| Trước, 600 ms | Có | `trailing_silence` | 1500 ms | 600 ms | 2100 ms | 1.658 ms | 2.032 ms |
| Sau, 1000 ms | Không | `speaking` | 1500 ms | 600 ms | 2100 ms | 1.621 ms | 2.067 ms |

Kết luận: đây là điểm bắt đầu cải thiện. Cấu hình mới không cắt câu tại một khoảng nghỉ đúng 600 ms.

### T3 - Khoảng nghỉ 800 ms

| Cấu hình | Endpoint | Lý do | Speech | Im lặng cuối | Tổng audio | Mean | p95 |
|---|---|---|---:|---:|---:|---:|---:|
| Trước, 600 ms | Có | `trailing_silence` | 1500 ms | 800 ms | 2300 ms | 1.934 ms | 2.555 ms |
| Sau, 1000 ms | Không | `speaking` | 1500 ms | 800 ms | 2300 ms | 1.808 ms | 2.209 ms |

Kết luận: khoảng nghỉ suy nghĩ/lấy hơi 800 ms được giữ trong cùng một turn sau thay đổi.

### T4 - Khoảng nghỉ 1000 ms

| Cấu hình | Endpoint | Lý do | Speech | Im lặng cuối | Tổng audio | Mean | p95 |
|---|---|---|---:|---:|---:|---:|---:|
| Trước, 600 ms | Có | `trailing_silence` | 1500 ms | 1000 ms | 2500 ms | 2.408 ms | 3.876 ms |
| Sau, 1000 ms | Có | `trailing_silence` | 1500 ms | 1000 ms | 2500 ms | 2.019 ms | 2.524 ms |

Kết luận: cấu hình mới đóng turn tại đúng ngưỡng 1000 ms như thiết kế.

### T5 - Khoảng nghỉ 1200 ms

| Cấu hình | Endpoint | Lý do | Speech | Im lặng cuối | Tổng audio | Mean | p95 |
|---|---|---|---:|---:|---:|---:|---:|
| Trước, 600 ms | Có | `trailing_silence` | 1500 ms | 1200 ms | 2700 ms | 2.086 ms | 2.582 ms |
| Sau, 1000 ms | Có | `trailing_silence` | 1500 ms | 1200 ms | 2700 ms | 2.098 ms | 2.528 ms |

Kết luận: cả hai đều xác định người nói đã kết thúc; cấu hình mới chỉ chờ lâu hơn 400 ms.

## 4. Tổng hợp thay đổi định lượng

| Chỉ số trên bộ 5 kịch bản | Trước | Sau | Thay đổi |
|---|---:|---:|---:|
| Số trường hợp bị đóng turn | 4/5 | 2/5 | Giảm 2 trường hợp |
| Tỷ lệ đóng turn | 80% | 40% | Giảm 40 điểm phần trăm |
| Khoảng nghỉ vẫn giữ câu | `< 600 ms` | `< 1000 ms` | Tăng cửa sổ chịu pause thêm 400 ms |
| Độ trễ EOU danh nghĩa sau âm cuối | 600 ms | 1000 ms | Tăng 400 ms |
| Mean CPU EOU, trung bình 5 lượt | 1.937 ms | 1.831 ms | Chênh -0.106 ms, không đáng kể |
| p95 CPU EOU lớn nhất | 3.876 ms | 2.528 ms | Không tạo nút thắt so với ASR/network |

Mean CPU chỉ phản ánh lần chạy này và có nhiễu lập lịch của hệ điều hành. Kết luận đáng dùng là chi phí EOU nằm ở mức vài mili giây, nhỏ hơn nhiều so với 1000 ms chờ im lặng và latency STT khoảng hàng trăm mili giây trong log Live Actor.

## 5. Kết quả từng lượt test chức năng

Bộ `python -m unittest stt_service.test_eou` có 5 test và đã pass 5/5:

| Test | Input | Kỳ vọng | Kết quả |
|---|---|---|---|
| F1 | 500 ms speech + đủ trailing silence theo config | Endpoint, `trailing_silence` | Pass |
| F2 | 500 ms speech + thiếu 100 ms so với ngưỡng | Không endpoint, `speaking` | Pass |
| F3 | 100 ms speech, `is_final=true` | Endpoint, `client_final` | Pass |
| F4 | Speech dài hơn `maxUtteranceMs` 20 ms | Endpoint, `max_duration` | Pass |
| F5 | Chuỗi `Đấy.` lặp 20 lần và một câu bình thường | Chặn chuỗi lặp, giữ câu bình thường | Pass |

Kiểm tra build liên quan:

| Thành phần | Lệnh | Kết quả |
|---|---|---|
| STT syntax | `python -m compileall stt_service` | Pass |
| Voice TypeScript | `npm run typecheck` | Pass |
| Frontend production build | `npm run build` | Pass; chỉ có cảnh báo chunk lớn của Vite |

## 6. Đối chiếu với lỗi Live Actor trước thay đổi

Log trước thay đổi cho thấy một câu nói bị tách thành nhiều final ngắn như `Để ra`, `mới đã được`, `Cấu hình...`, `cho 50 người dùng`. Mỗi final lại kích hoạt một lượt dịch độc lập, nên bản dịch không có đủ ngữ cảnh câu.

Log cũng có một final dài chứa `Đấy.` lặp rất nhiều lần. Bộ lọc mới đánh dấu được trường hợp tổng hợp `Đấy.` lặp 20 lần, nhưng không chặn `Đấy, đấy, đấy` chỉ có ba token vì đó vẫn có thể là lời nói hợp lệ.

Không thể đưa ra con số “giảm bao nhiêu phần trăm fragment trên mic thật” từ log hiện có vì thiếu:

- audio gốc để replay cùng một đầu vào;
- số event `speech_end`/`turn.end` trước và sau;
- timestamp âm cuối, `stt.final` và translation final;
- transcript tham chiếu để tính WER/CER.

## 7. Bộ test thực địa cần chạy để có số liệu hệ thống hoàn chỉnh

Mỗi cấu hình 600 ms và 1000 ms nên chạy cùng 10 câu, ba lượt/câu. Với từng lượt cần lưu:

| Trường | Ý nghĩa |
|---|---|
| `test_id`, `run` | Định danh câu và lượt lặp. |
| `pause_pattern_ms` | Các khoảng nghỉ chủ động trong câu. |
| `speech_end_count` | Số lần VAD kết thúc speech. |
| `stt_final_count` | Số đoạn final tạo ra cho một câu mong muốn. |
| `endpoint_latency_ms` | Từ âm cuối tới `turn.end`. |
| `asr_latency_ms` | Thời gian STT của final. |
| `translation_latency_ms` | Thời gian dịch. |
| `complete_sentence` | Final có đủ ý hay bị vỡ đoạn. |
| `hallucination` | Có nội dung lặp/bịa từ im lặng hay không. |
| `WER` hoặc `CER` | Sai số so với transcript chuẩn. |

Tiêu chí chấp nhận đề xuất: giảm ít nhất 50% số câu có hơn một `stt.final`, không tăng hallucination, p95 từ âm cuối tới `stt.final` không tăng quá 500 ms, và không cắt câu tại pause 600–900 ms.
