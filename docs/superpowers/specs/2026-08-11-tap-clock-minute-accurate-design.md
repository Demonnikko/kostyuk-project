# TAP Clock: Minute-Accurate Project Design

## Goal

Build a new `.tapProject` for The Architect of Predictions (TAP) that turns a six-digit PIN `HHMM00` into the supplied photograph with an analog pocket watch showing exactly `HH:MM`.

## Accepted input

- Digits 1–2: hour, accepted range `00` through `23`.
- Digits 3–4: minute, accepted range `00` through `59`.
- Digits 5–6: dummy closing digits; the performance code uses `00` and these digits do not affect the image.
- `00:MM` and `12:MM` produce the same analog position.
- `13:MM` through `23:MM` map to `01:MM` through `11:MM` on the analog dial.
- Examples: `104000 → 10:40`, `125000 → 12:50`, `005000 → 12:50`, `231700 → 11:17`.

## Root cause in v9

The v9 hour-hand input contains only 72 images and calculates its index with `minute / 10`. That provides six hour-hand positions per hour, not sixty. Non-multiples of ten therefore cannot select an exact integer image. Hours above 12 also produce indexes beyond the 72-image set. The old hand assets are oversized raster images and the output frame does not match the new 1024×1536 source, which contributes to poor edges and alignment.

## Considered architectures

1. Separate hour and minute layers, with 720 hour-hand images and 60 minute-hand images. This is smaller than full composites but keeps two independently selected layers and creates a visible synchronization risk.
2. Twelve normalized analog-hour banks. This halves the number of duplicate banks, but requires extra conditional normalization for `00` and `13–23`; formula mistakes would recreate the current failure mode.
3. Twenty-four direct hour banks, one for every accepted `00–23` value. Each bank contains the 60 complete paired-hand renders plus transparent safety images. This is larger but uses only direct equality and minute indexing.

Chosen approach: option 3. Reliability and transparent debugging are more important than archive size.

## Rendering design

- Use the exact supplied 1024×1536 PNG as the visual source; do not use the AI mockup as a production asset.
- Dial crop: 360×360 pixels, source origin `(500, 740)`, pivot `(178, 176)` inside the crop, corresponding to source coordinate `(678, 916)`.
- Render at 8× supersampling and downsample with Lanczos for crisp antialiased edges.
- Approved appearance: late-19th-century blued-steel spade/leaf hands, dark blue-black rather than flat black, with a narrow steel highlight and opaque edges.
- Minute hand: long and slender, terminating just inside the minute track.
- Hour hand: shorter and slightly broader.
- A small dark metal center cap covers the original brass pivot.
- At minute `m`, minute angle is `6m` degrees clockwise from 12.
- At analog hour `h`, hour angle is `30(h mod 12) + 0.5m` degrees clockwise from 12.
- Each time render contains both hands and the cap in one transparent PNG, so the hands cannot become desynchronized.

## TAP project structure

- Three number inputs: `clockhour` on digits `[0,1]`, `clockminute` on `[2,3]`, and `dummy` on `[4,5]`.
- Twenty-four calculated image inputs: `time00` through `time23`.
- Each image input contains exactly 100 PNGs, respecting TAP's displayed 100-image capacity:
  - images `1.png` through `60.png`: exact minutes `00` through `59` for that hour;
  - images `61.png` through `100.png`: fully transparent safety images.
- Each bank condition directly compares `clockhour` with its bank hour. On match it selects `clockminute + 1`; otherwise it selects transparent image 61.
- Twenty-four overlaid outputs use the same square normalized frame matching the 360×360 crop. Only the matching bank is visible.
- Invalid hours show no hands; invalid minutes `60–99` select transparent images instead of producing TAP's “Invalid digits” error.

## Verification

- Exhaustively validate all 1,440 valid times from `00:00` through `23:59`.
- Confirm exactly one bank is active for every valid time and every selected index is in `1–60`.
- Validate hand angles with hand-derived fixtures, including `00:00`, `10:40`, `12:50`, `13:00`, `23:59`.
- Inspect every production PNG for 360×360 RGBA format, visible pixels for active frames, and zero alpha for safety frames.
- Verify archive contents, JSON links, unique output hashes, 24×100 image files, base image dimensions, and ZIP integrity.
- Import the final file into TAP through iPhone Mirroring and run representative PINs after the user unlocks the mirroring window.

## Deliverable

One versioned `.tapProject` file, preserving the v9 file unchanged, plus an optional reference preview showing the approved hands at `10:40`.
