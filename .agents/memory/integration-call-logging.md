---
name: Integration call logging table
description: Which table to use for outbound third-party API call telemetry vs LLM usage
---

Two telemetry tables exist and are easy to confuse:

- `integration_call_log` — outbound vendor/HTTP API telemetry. Columns: `vendor`, `endpoint`, `status` (ok|error|rate_limited|timeout), `http_status`, `duration_ms`, `cost_estimate_usd`, `brand_id` (nullable), `request_meta` (jsonb), `error_message`. This is the correct target for third-party integration calls (e.g. DataForSEO).
- `usage_logs` — LLM/AI token usage. Requires `model` (NOT NULL) and is token-oriented (`input_tokens`, `output_tokens`, cache token columns, `estimated_cost_usd`). Not suitable for non-LLM HTTP calls.

**Rule:** Log outbound vendor API calls to `integration_call_log`. Do not route them into `usage_logs` even if a spec loosely calls it a "usage log".

**Why:** `usage_logs` is shaped for LLM token accounting (`model` is mandatory); forcing HTTP integration calls into it would require fake fields and lose the vendor/endpoint/status semantics that `integration_call_log` already captures.

**How to apply:** The DataForSEO client centralizes this in its `logCall()` → `integration_call_log`. New endpoints reuse that path. If a dispatch/spec says "log to usage_logs" for integration calls, treat it as naming the cost-log concept loosely and keep `integration_call_log`, noting the divergence.
