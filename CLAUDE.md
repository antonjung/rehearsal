# OffBook

**Live app:** https://antonjung.github.io/rehearsal/

## overview
OffBook is an app to aid learning lines for a play

## Functions

Load scripts from a text file or photo. Multiple allowed.
Extract from the script a list of characters and populate a table
Rehearsal mode - select your script and choose your character
Read script as audio for all characters with different voices for each
Choose to have stage directions read or not
Choose from:
  A. Leave silence for your lines
  B. Have your lines read
  C. Leave a silent gap before your lines are read
  D. Leave a silent gap after your lines are read
Animate the text as your lines are read
Analyze your lines as you speak them and give an accuracy rating
Audible warning if accuracy goes below a specified percentage
Mark a block of text (clip region) with draggable red line markers
Repeat/loop the clip — toggle button in the controls bar
Highlight differences in the text and your speech

From the characters screen add a button to select one of the scenes they are in and display the scene with their lines highlighted.
In settings choose the voice that is used if one isn't selected for each character
Voice selection groups voices by language/region (matching iOS Settings structure), with British English first. All voices returned by the Web Speech API are shown — no filtering by locale.
Note: voices listed under "Eloquence" in iOS Settings are not available to browser apps (Apple restriction) — only standard voices such as Daniel are accessible.
The gap shouldn't be a fixed time but the time it would take to say the character's line

## Rehearsal mode — clip markers

Two red horizontal lines define the clip (practice region):
- Clip start marker sits above the first line of the clip
- Clip end marker sits below the last line of the clip
- Touch and drag a marker to reposition it; the view auto-scrolls when the finger nears the top/bottom edge
- While dragging, only the animated overlay line is shown; the static marker reappears on finger-lift at the snapped position
- ▶ always starts playback from the clip start line
- Lines within the clip region have a subtle amber background tint to distinguish them from context lines outside the clip

## Rehearsal mode — controls

- ↺ Repeat pill (always visible): toggles loop mode — when on the clip replays automatically after completion
- Transport buttons (▶ ⏸ ⏹ ⏮ ⏭) are all the same large size
- My character's lines are persistently highlighted with a subtle accent-colour tint

## Rehearsal mode — recordings

Each dialogue line can have a recorded version (recorded in the Record tab or via the ● button per line in rehearsal).
Recordings are played back via AudioContext (not HTMLAudioElement) so they work on iOS without a per-play user gesture.
If no recording exists for a line, TTS is used as fallback.
If a recording exists but playback is cancelled (stop / pause / skip / back), the TTS fallback is suppressed — guarded by stopRef, pauseRef, and runId checks.

## iOS notes

- Eloquence voices are not accessible in browsers — only standard voices (e.g. Daniel) appear via Web Speech API
- AudioContext must be unlocked inside a user-gesture handler (done in handlePlay via unlockAudio())
- speechSynthesis.speak() must be called synchronously inside a user-gesture handler to activate the iOS audio session — a silent prime utterance is used at play time
- Silent utterance bug: onend can fire without onstart for consecutive TTS calls; useSpeechSynthesis retries with increasing delay when this is detected
- Touch drag: clip markers stay in the DOM (opacity 0) during drag rather than being unmounted, to keep the iOS touch event chain intact
