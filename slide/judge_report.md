# VietBridge AI - AI Singapore Hackathon Judge Report

This report is intentionally adversarial. It distinguishes implemented behavior, targets and evidence that is still missing.

## Executive verdict

The deck now has a clearer product story and a credible engineering surface. It is not yet Top 3 ready because translation accuracy, latency and noisy-room robustness are still presented as open measurements rather than demonstrated results.

Estimated current position: Top 30% if the live demo is stable; below Top 10% until benchmark evidence is added.

| Rubric | Weight | Current estimate | Reason for deduction |
| --- | ---: | ---: | --- |
| Translation accuracy | 30% | 4/10 | Context example is useful, but no dataset, baseline, WER/COMET/BLEU or human evaluation. |
| Latency and responsiveness | 20% | 5/10 | Runtime exposes latency and the deck states targets, but no p50/p95 result. |
| UX and meeting flow | 20% | 7/10 | Two-device and zero-touch flow are concrete and easy to understand. |
| Robustness | 15% | 5/10 | Reconnect and VAD fallback exist in code, but no forced-failure or noisy-room evidence. |
| Technical design and deployability | 15% | 6/10 | Pipeline is understandable; current provider dependency and on-premise status remain open. |
| **Weighted total** | **100%** | **5.3/10** | Evidence is the main ceiling. |

## Slide-by-slide review

| Slide | Goal and story | Main deduction | Minimum fix |
| --- | --- | --- | --- |
| 1. Cover | Clearly states the product and meeting use case. | No quantified promise or proof signal. | Add one measured headline after the benchmark exists. |
| 2. Problem | Makes interruption, controls and context loss concrete. | Does not quantify business cost. | Add interview count or observed delay only when verified. |
| 3. Insight | Explains why speaker identity, turn timing and context matter. | Still partly conceptual. | Show one failure trace from the baseline. |
| 4. Product UX | Shows why two devices reduce interaction cost. | No usability observation or task completion evidence. | Run a short two-person task test and record errors/time. |
| 5. Context | Gives a strong pilot-project reference example. | One hand-picked example is not an evaluation. | Add a small test set and baseline comparison. |
| 6. Architecture | Shows capture, VAD, ASR, context and delivery. | External provider dependency is not fully cost/privacy scoped. | State data path, retention and fallback policy. |
| 7. Engineering | Separates target, implemented and TBD claims. | No measured robustness result yet. | Fill the table with p50/p95, noise and reconnect results. |
| 8. Evaluation | Makes missing evidence visible to reviewers. | It is currently an empty contract. | Do not present as complete until at least one baseline is filled. |
| 9. Live demo | Gives a concrete happy path plus recovery path. | Mock output can be mistaken for a real result. | Label mock UI during presentation and show live timestamps. |
| 10. Roadmap/closing | Connects MVP to deployable meeting intelligence. | Ask is broad and moat is not proven. | Ask specifically for evaluation users, data or deployment partner. |

## Hard judge questions

1. What is your p50 and p95 end-to-end latency from speech end to translated text?
2. How do you define the end of a turn, and what is the false-cut rate?
3. What accuracy metric do you use for Vietnamese-English business speech?
4. What is the baseline: Google Translate, a single shared microphone, or a current human workflow?
5. How many utterances and speakers are in your evaluation set?
6. How does the system behave when both participants speak at the same time?
7. What happens when the VAD model cannot load or the browser has no model assets?
8. What happens when the WebSocket drops while audio is buffered?
9. Can you guarantee ordering when packets are delayed or duplicated?
10. What is stored, for how long, and where does meeting audio leave the customer environment?
11. Why are external FPT/Groq providers acceptable for a sensitive business meeting?
12. What is your plan for on-premise or edge inference, and what accuracy trade-off does it create?
13. How does the glossary prevent harmful or incorrect terminology overrides?
14. How do you measure context improvement instead of only showing one example?
15. How does noise suppression affect speech recognition and translation quality?
16. What is the maximum meeting duration and concurrent-session capacity?
17. How do you handle provider timeout, rate limit and partial-result disagreement?
18. Which part is your technical moat rather than an orchestration of APIs?
19. What user behavior proves the two-device design is better than one device with diarization?
20. What exact result would make you stop shipping this approach?

## Twenty fixes for the final 24 hours

| Priority | Work | Severity | Estimate | Expected score lift | Why it matters |
| ---: | --- | --- | ---: | ---: | --- |
| 1 | Run a fixed VI-EN business utterance set end to end. | Critical | 2h | High | Replaces opinion with reproducible evidence. |
| 2 | Record p50/p95 partial and final latency. | Critical | 1h | High | Directly affects the 20% latency rubric. |
| 3 | Compare against one named baseline. | Critical | 2h | High | Judges need a reference point. |
| 4 | Test forced WebSocket drop and recovery. | Critical | 1h | Medium | Proves the resilience claim. |
| 5 | Run noisy-room cases at documented SNR levels. | Critical | 2h | High | Addresses the stated real-world use case. |
| 6 | Test overlapping speech and false turn cuts. | High | 1h | High | Exposes the hardest meeting-flow failure. |
| 7 | Fill the evaluation table in slide 8. | Critical | 30m | High | The current table is visibly incomplete. |
| 8 | Capture a real demo recording with timestamps. | High | 1h | Medium | Prevents the mock screen from being treated as proof. |
| 9 | Add a one-line data retention/privacy statement. | High | 30m | Medium | Removes a deployability objection. |
| 10 | State provider fallback and timeout behavior. | High | 45m | Medium | Shows operational maturity. |
| 11 | Add a business glossary failure example. | Medium | 45m | Medium | Demonstrates guardrail trade-offs. |
| 12 | Add task completion time for two-device UX. | Medium | 1h | Medium | Converts UX claim into evidence. |
| 13 | Verify all slide claims are labeled measured/target/TBD. | High | 30m | Medium | Avoids credibility penalties. |
| 14 | Remove any future feature without a judging payoff. | Medium | 30m | Low | Keeps the pitch focused. |
| 15 | State concurrency and session-size limits. | Medium | 45m | Medium | Answers scalability questions. |
| 16 | Run `npm run typecheck` in `voice/`. | High | 5m | Medium | Prevents a live technical failure. |
| 17 | Run `npm run build` in `voice/`. | High | 2m | Medium | Confirms deliverability. |
| 18 | Rehearse a 90-second product story. | High | 1h | Medium | Improves judge comprehension in the first minute. |
| 19 | Rehearse the failure recovery path. | High | 45m | Medium | Turns a weakness into engineering credibility. |
| 20 | Freeze the deck and prepare a one-page metric handout. | Medium | 30m | Low | Keeps Q&A precise and consistent. |

## Design audit

- Typography is standardized on Calibri with explicit hierarchy.
- Slide count, counter and dot navigation are generated from the actual section count.
- Long technical cards use bounded grids and wrapping rules.
- The evaluation slide uses a fixed table structure so missing measurements are visible rather than hidden.
- The old missing `icon-translation` reference was removed.

## Final verdict

The strongest path to Top 3 is not adding more features. It is proving three claims: translation quality on business speech, end-to-end latency under a stated condition, and recovery/noise behavior during a live meeting. Until those are measured, the deck should present VietBridge as a technically promising MVP with a clear evaluation gap, not as a proven production translator.
