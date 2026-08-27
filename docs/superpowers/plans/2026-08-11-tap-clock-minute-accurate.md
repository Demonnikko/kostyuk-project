# TAP Clock Minute-Accurate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a TAP project where every valid PIN `HHMM00` for `00:00–23:59` displays mathematically exact, approved antique pocket-watch hands.

**Architecture:** A deterministic Python builder renders paired hour/minute hands into 24 direct hour banks. Each bank uses a conditional TAP image input with 60 active minute frames and 40 transparent safety frames; all outputs overlay the same undistorted dial crop.

**Tech Stack:** Python 3, Pillow, OpenCV for diagnostic geometry only, `unittest`, ZIP/JSON from the standard library, TAP project format version 4.

## Global Constraints

- Preserve `/Users/dmitrijkostuk/Desktop/Часы_ЧЕРНЫЕ_СТРЕЛКИ_v9.tapProject` unchanged.
- Use `/Users/dmitrijkostuk/Desktop/BD5D9B47-C7B5-4F45-B8F3-DF9591FF36D9.PNG` as the source photograph.
- Decode `HHMM00`; accept hours `00–23`, minutes `00–59`, and ignore the final two digits.
- Treat `00:MM` as `12:MM` on the analog dial.
- Minute accuracy is one minute; the hour hand moves by 0.5 degrees per minute.
- Use the approved blued-steel spade/leaf hand design with crisp opaque edges.
- Never modify face, hand, clothing, watch case, dial, chain, lighting, framing, or background.
- Preserve the full 1024×1536 aspect ratio and use a square, non-distorting output frame.

---

### Task 1: Clock math and direct-bank selection

**Files:**
- Create: `tools/tap-clock-v10/clock_math.py`
- Create: `tests/tap_clock_v10/test_clock_math.py`

**Interfaces:**
- Produces: `analog_angles(hour: int, minute: int) -> tuple[float, float]` returning hour and minute clockwise degrees.
- Produces: `bank_selection(input_hour: int, input_minute: int) -> dict[int, int]` returning image indexes for banks `0–23`.

- [ ] **Step 1: Write failing literal-fixture tests** for `00:00 → (0,0)`, `10:40 → (320,240)`, `12:50 → (25,300)`, `23:59 → (359.5,354)`, and exactly one active bank for all 1,440 valid times.
- [ ] **Step 2: Run `python3 -m unittest tests.tap_clock_v10.test_clock_math -v`** and verify failure because `clock_math` does not exist.
- [ ] **Step 3: Implement input validation, angle calculation, and 24-bank selection** with index `minute + 1` for the matching hour and transparent index `61` for all other banks.
- [ ] **Step 4: Re-run the test module** and require zero failures.

### Task 2: Deterministic approved hand renderer

**Files:**
- Create: `tools/tap-clock-v10/render_hands.py`
- Create: `tests/tap_clock_v10/test_render_hands.py`

**Interfaces:**
- Consumes: `analog_angles(hour, minute)` from Task 1.
- Produces: `render_pair(hour: int, minute: int) -> PIL.Image.Image` as 360×360 RGBA.
- Produces: `render_preview(source_path: Path, out_path: Path, hour: int, minute: int) -> None`.

- [ ] **Step 1: Write failing renderer tests** asserting 360×360 RGBA output, transparent corners, opaque center cap at `(178,176)`, minute-tip coverage near the hand-derived `10:40` coordinate `(88,228)`, and absence near the contradictory 4 o'clock coordinate.
- [ ] **Step 2: Run `python3 -m unittest tests.tap_clock_v10.test_render_hands -v`** and verify the expected missing-module failure.
- [ ] **Step 3: Implement an 8× supersampled vector renderer** with separate hour/minute spade polygons, dark blue-black fill, narrow highlight, center cap, exact rotations, and Lanczos downsampling.
- [ ] **Step 4: Re-run renderer and clock tests** and require zero failures.
- [ ] **Step 5: Generate a deterministic `10:40` preview** and visually inspect that the minute hand points at 8 and the hour hand sits two-thirds from 10 to 11.

### Task 3: TAP archive builder

**Files:**
- Create: `tools/tap-clock-v10/build_project.py`
- Create: `tests/tap_clock_v10/test_project_build.py`

**Interfaces:**
- Consumes: `render_pair` and the supplied source image.
- Produces: `build_project(source_path: Path, output_path: Path) -> Path`.
- Produces archive entries `baseImage.jpg`, `previewImage.jpg`, `contents.json`, and `inputs/timeHH/1.png` through `100.png`.

- [ ] **Step 1: Write a failing integration test** that builds into a temporary directory and asserts ZIP integrity, version 4 JSON, three numeric inputs, 24 conditional image inputs, 24 linked outputs, unique hashes, 2,400 PNG entries, 100 image files per bank, and a 1024×1536 base image.
- [ ] **Step 2: Run `python3 -m unittest tests.tap_clock_v10.test_project_build -v`** and verify the expected missing-builder failure.
- [ ] **Step 3: Implement the archive builder** using direct hour equality, minute index plus one, transparent safety images 61–100, square normalized output points `(500,740)–(860,1100)`, and a deterministic 10:40 preview.
- [ ] **Step 4: Re-run all Task 1–3 tests** and require zero failures.

### Task 4: Independent archive verifier and final artifact

**Files:**
- Create: `tools/tap-clock-v10/verify_project.py`
- Create: `tests/tap_clock_v10/test_verify_project.py`
- Create: `Часы_ИДЕАЛЬНЫЕ_ТОЧНО_ДО_МИНУТЫ_v10.tapProject`

**Interfaces:**
- Produces: `verify_project(project_path: Path) -> list[str]`, returning an empty list only for a structurally valid and exhaustive project.

- [ ] **Step 1: Write a failing verifier test** using a deliberately malformed archive with a missing minute frame and duplicate output hash; assert both problems are reported.
- [ ] **Step 2: Run `python3 -m unittest tests.tap_clock_v10.test_verify_project -v`** and verify the expected missing-verifier failure.
- [ ] **Step 3: Implement independent verification** without calling builder internals: parse JSON, enumerate bank folders, validate image indexes and transparency, simulate all 1,440 valid times, and run ZIP CRC checks.
- [ ] **Step 4: Run the complete suite with `python3 -m unittest discover -s tests/tap_clock_v10 -v`** and require zero failures.
- [ ] **Step 5: Build the versioned final artifact** from the supplied 1024×1536 source and run `verify_project.py` against it.
- [ ] **Step 6: Inspect archive size, SHA-256, and deterministic 10:40 preview** before TAP import.

### Task 5: TAP import and representative performance checks

**Files:**
- Verify: `Часы_ИДЕАЛЬНЫЕ_ТОЧНО_ДО_МИНУТЫ_v10.tapProject`

**Interfaces:**
- Consumes the final archive from Task 4.
- Produces a recorded pass/fail table for representative PINs.

- [ ] **Step 1: After the user unlocks iPhone Mirroring, import the v10 project into TAP** without deleting or overwriting v9.
- [ ] **Step 2: Test `000000`, `005000`, `104000`, `125000`, `130000`, `231700`, and `235900`** and confirm each reaches the generated photograph without an “Invalid digits” alert.
- [ ] **Step 3: Visually verify the directions at `10:40`, `12:50`, and `23:59`** against the mathematical angle table.
- [ ] **Step 4: Export/save only if TAP requires it for the user's download flow**, preserving the verified v10 filename.
