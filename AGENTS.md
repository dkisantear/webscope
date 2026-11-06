# AGENTS.md — rules for every AI tool and teammate

WebScope: DE10-Lite FPGA oscilloscope → ESP32 → browser over Wi-Fi.

Read `docs/ARCHITECTURE.md` and `docs/PROTOCOL.md` before writing code.
Chat AIs without repo access (ChatGPT, Gemini): ask for this file plus those two docs before answering.
If a suggestion conflicts with the docs, the docs win. Propose a doc change instead.

## Rules
- Name the file/module first. Search the repo for existing code before writing new code.
- Extend existing modules; never duplicate or rewrite working code.
- One module = one job. New feature = new module or function called by a parent.
- Layers talk only through `docs/PROTOCOL.md`. Change the protocol doc first, then both sides in the same commit.
- Shared constants live in one file per layer: `fpga/rtl/scope_pkg.sv`, `firmware/include/protocol.h`, `ui/src/protocol.js`.
- Minimal, surgical changes. Say exactly where new code goes.
- No new libraries or IP without asking.
- Every layer runs on fake data (FPGA test pattern, ESP32 test mode, UI `?mock=1`).
- When adding a file, add it to the module list in `docs/ARCHITECTURE.md`.

## Git
- Commit prefix by layer: `fpga:`, `fw:`, `ui:`, `docs:`.
- No AI attribution in commits, PRs, or code (no `Co-Authored-By`, no "Generated with").
- Don't commit build output (`db/`, `incremental_db/`, `output_files/`, `.pio/`).
