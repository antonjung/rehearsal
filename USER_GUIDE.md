# CueLine — User Guide

CueLine helps you learn lines for a play. Load your script, pick your character, and run through the scene while every other character is read aloud — leaving a gap for your own lines.

Live app: https://antonjung.github.io/rehearsal/

This guide mirrors the **About** section built into the app (☰ menu → About).

---

## 1. The four tabs

| Tab | Purpose |
|---|---|
| **Home** | Your loaded scripts — select, rename, edit, export, delete |
| **Script** | Characters, scene breakdown, and cast tracks |
| **Record** | Pre-record other characters' lines in a real voice |
| **Run through** | Rehearse — everyone else is read aloud, you say your lines |

Plus the menu (☰, top-left) and settings (⚙️, top-right), both always available.

---

## 2. Loading a script (Home tab)

Open ☰ → **Scripts**:

- **Load** — open one or more `.txt` or `.pdf` files. Multiple scripts can be loaded at once.
- **Import** — restore a previously exported CueLine bundle (scripts, recordings, and tracks).
- **Examples** — try a built-in script with one tap.

Loaded scripts are listed on the **Home** tab, where you can select, rename, edit, export, or delete them. **Edit** (pencil icon) opens a line-by-line editor — change a line's text, character, or type, search the script, and bulk-reassign lines.

---

## 3. Script tab

See every character with a line count, or switch to the scene breakdown to see characters per scene. Tap a character (or a **track** — a named group of characters, e.g. for doubled-up roles) to browse their lines scene by scene, with their dialogue highlighted. Tap a scene to jump straight into a run-through of it.

---

## 4. Record tab

Pre-record lines for other characters in your own voice (or someone else's). Recordings play back during the run-through instead of text-to-speech, giving each character a distinct, human voice. Tap the microphone icon next to any line to record, re-record, or delete.

---

## 5. Run through tab

Choose a scene and your character, then tap **Start run through**. All other characters are read aloud (recordings or TTS). Your lines are highlighted — speak them yourself.

### During a run-through

- **Line modes** — set in ⚙️: *Silence* leaves a timed gap; *Read* speaks your line; *Gap before / Gap after* combines both in one order; *Gap · read · gap* and *Read · gap · read* add a repeat. The gap length matches the estimated speaking time for the line (or the actual recording duration if one exists), plus the minimum gap set in Settings.
- **Progress bar** — a bar fills across your line as the gap counts down.
- **Clip markers** — two red lines define a practice region. Drag them to reposition. Playback always starts from the clip start. Long-press a line to set the clip start or end there.
- **Repeat** — loops the clip automatically when it ends.
- **Condensed mode** — when there are more lines between your cues than the threshold you set, the middle is skipped: a sound plays, the number of skipped lines is announced, and only the cue line immediately before your next line is read.
- **Record in rehearsal** — tap the ● button next to any line to record it on the spot without leaving the run-through.
- **Show / hide lines** — your lines can be blurred until you tap to reveal them, to test recall without prompts.
- **Search** — tap the magnifier to find any word or phrase in the script and jump to it.
- **Accuracy** — if enabled, CueLine listens to your lines, scores how closely they match the script, highlights the differences, and warns you if you drop below your chosen threshold. A summary appears at the end of the run.
- **Hands-free** — with hands-free mode on, say "start" to begin. During playback say "stop", "back", "skip", "repeat", or "loop" to control playback without touching the screen.

---

## 6. Settings (⚙️)

| Setting | What it does |
|---|---|
| **Line mode** | silence / read / gap before / gap after / gap·read·gap / read·gap·read |
| **Minimum gap** | a floor added to every gap (default 1s) so short lines still leave a usable pause |
| **Speech rate** | speed up or slow down TTS |
| **Voice** | choose the TTS voice used for other characters |
| **Stage directions** | choose whether directions are read aloud |
| **Signals** | cue ping before your lines; completion sound at scene end |
| **Appearance** | theme, script font size, and highlighter colour |
| **Voice commands** | customise the trigger words for each hands-free command |
| **Voice calibration** | read a sample phrase at your natural pace so gap timing matches how you speak |
| **Microphone** | test your mic input |

Voices are grouped by language/region the same way iOS Settings does, with British English listed first. Every voice your browser exposes is shown — CueLine doesn't filter by locale.

---

## 7. Notes

Open ☰ → **Notes** for a simple running list of reminders. Add, tick off, edit, or clear completed notes — handy for jotting things down mid-rehearsal without leaving the app.

---

## 8. Your data

Scripts, recordings, notes, and settings stay on this device — nothing is uploaded to a server, including PDF text extraction. Use Export/Import (☰ menu) to back up a script or move it to another device.

---

## 9. iOS notes

Standard voices (e.g. Daniel) are available via the Web Speech API. Eloquence voices shown in iOS Settings are not accessible to browser apps. The first tap of Play in a session unlocks audio — this is a browser requirement.
