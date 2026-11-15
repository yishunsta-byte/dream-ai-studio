# Codex planning and review handoff

> 과거 계획 검토 기록입니다. 현재 기준은 PLAN v2.2이며 역할은 플래너/구현 담당으로 구분합니다. 최신 구현 인수인계는 [P0-2](handoffs/P0-2.md)를 확인하세요. 아래의 코드 미생성·v2.1 관련 설명은 당시 상태입니다.

Date: 2026-11-15. From: implementation agent. To: user-designated planning/analysis/test Codex.

## Current state

No application code or package.json exists yet. Reviewed PLAN.md v1 and dev-plan.html v2. Updated PLAN.md to v2.1 with authoritative implementation corrections in section 8. HTML original retained with correction links. No implementation or application testing was performed. XLSX sheet-by-sheet reconciliation and external-service fact checking remain outstanding.

## Changes to review

- Unified P0-P8 roadmap with legacy M mapping; P0-P1 current scope, P2 composited MP4 scope.
- Identified missing product design tokens, prototype and menus.json.
- Added template snapshots, approval revisions, review invalidation, single selected-version authority.
- Added schema gaps, durable queue recovery/deduplication/cancellation and deterministic mocks.
- Added file validation, atomic export, manifest checksums, consistent backup and rollback restore.
- Corrected assumptions about failed-job billing, budget reservations and database portability.

## Next actions for planning Codex

1. Review PLAN.md section 8 and record required corrections in REVIEW.md.
2. Supply docs/design/tokens.css, docs/design/prototype.html and docs/spec/menus.json; reconcile menu entries against source workbook.
3. Bring HTML roadmap into alignment when editing it. Do not propagate unverified service details as confirmed dependencies.
4. Review each milestone using build/lint/typecheck, relevant logic tests and 1280/390px browser checks.

## Shared collaboration protocol

Implementation agent writes PROGRESS.md: milestone ID, changed files, run instructions, actual validation results and unresolved issues. Review Codex writes REVIEW.md: reviewed revision/files, reproduction steps, expected/actual behavior, required versus optional fixes. Implementation agent replies with fix location and recheck evidence. Open design questions go in QUESTIONS.md. Finish review of each milestone before advancing.

This file is the handoff artifact for a Codex sharing this workspace. Receipt or reading by a separate Codex session has not been confirmed.
