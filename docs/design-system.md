# Canvas design system

Mobile Canvas follows the current Expo website and dashboard: a light, neutral interface with hairline borders, the Mobile Canvas text wordmark, Inter for labels, a black primary action and blue reserved for selection. The canvas is a design tool; the interfaces authored inside its frames keep their own app styling and never inherit the canvas palette.

## Sources

The reference is `expo.dev`, captured on September 8, 2026, and Universe's `server/website` at the supplied worktree. The current header uses a Mobile Canvas text wordmark in bundled Inter Medium. The earlier Expo SVG asset remains in `packages/native-canvas/Resources` with its MIT notice; Inter's OFL notice also accompanies the font there. System UI text uses SF; code and paths use SF Mono.

## Tokens

Defined once in `packages/native-canvas/Sources/CanvasStyle.swift` as `Palette` and `Fonts`.

| Token | Value | Use |
| --- | --- | --- |
| canvas | `#F2F3F5` | board background, grouped toolbar controls, secondary pills |
| surface | `#FFFFFF` | toolbar, status bar, inspector, frame bodies |
| hairline | `#E4E5E9` | separators between toolbar, canvas, status bar and inspector |
| border | `#D5D8DE` | frame borders, inspector fields |
| ink | `#1C2024` | titles, primary pill fill |
| icon | `#3C4148` | toolbar symbols |
| muted | `#6B7178` | frame names, captions, status text |
| faint | `#9AA0A6` | flow connectors, hints, dimensions |
| blue | `#0A7AF5` | selection, focused fields, active toggles, selected flow edges |
| green / amber / red | `#30A46C` / `#F0A020` / `#E5484D` | status dot: ready, loading, error; green also pulses a live navigation |

Type: Inter Medium 14 for the project name, 13 for pill labels, 12 for frame names and 11 for captions; SF 12 for status and messages, SF Mono 11–12 for paths and code. Hairlines are one device pixel.

## Components

- **Toolbar** (52 pt): wordmark, divider and truncating project name on the left; undo/redo, panel toggles, Agent and the black New screen pill on the right. Symbol buttons are 36 × 36 pt with tooltips and shortcut hints. Toggles show blue on a blue tint.
- **Frame**: a white body with a one-pixel border and a soft shadow, and its name above it in muted 12 pt. Selection turns the name and border blue and shows the frame's dimensions on the right. Name font and border width are divided by the zoom so they hold one screen size. Unmounted frames show a faint placeholder.
- **Flow connectors**: curves from the nearest edges with an arrowhead at the destination; forward edges faint and solid, return edges dashed, the selected frame's edges blue, a live navigation green.
- **Status bar** (30 pt): a colored dot with the readiness text on the left, a hint for the current mode on the right.
- **Inspector** (300 pt): heading and source path, then captioned fields with 6 pt corners and one-pixel borders that turn blue when focused; **Apply changes** is the black pill, **Discard** and the tools (View source, Reset state, Duplicate) are outlined pills.

- **Screen navigator** (224 pt): a white left panel with screen count, search by name/key/source and a scrollable list. Recognized pager steps stay together in sequence, even when import appended them after other routes. Rows carry a screen or step icon, name and key/step count; selection uses a blue tint. Clicking a row uses the same fit-and-focus action as clicking a frame. CLI/MCP selection updates the list, too. ⇧⌘L toggles it.
- **Canvas tools**: two floating white groups at the bottom of the board, with a light border and restrained shadow. Select/hand, flow and arrange sit together; zoom out, a percentage menu and zoom in sit beside them. The menu includes fit all, fit selection, actual size and presets. Camera fits reserve room for the controls so they never cover the focused screen. The tools render above native frame windows and leave keyboard focus with the canvas.
- **Inspector details**: visibly labeled X/Y fields, compact preview/context editors, a full-width View source action and equal-width Reset state/Duplicate actions. Labels stay on one line. Switching screens resets the inspector scroll position; unsaved drafts remain protected. Offline and step explanations stay brief.

## Rules

- Set the Mobile Canvas text wordmark in Inter Medium with the neutral ink color.
- Default to the light interface; the window overrides to light so app frames are judged consistently.
- Blue means selection, focus and informational feedback only. Primary actions are black on white; everything else is neutral.
- Pill-shaped actions, 8 pt grouped controls, 6 pt fields, hairline separators and restrained shadows. Outer frames stay square: they are iPhone screens, not cards.
- Never apply the canvas palette to project components. Real Expo UI and Liquid Glass are authored in the mobile source files.

- Clicking an unselected frame fits and centers its whole body and title, with margin around it and space for the inspector. The 220 ms camera move can be interrupted by a new selection or gesture; keyboard fits and Reduce Motion apply immediately.
- Agent screen inspection adds a dashed blue outer ring and a small “Agent inspecting” label above the title. On capture it changes to “Captured for agent” and fades away; ordinary selection retains its solid border. The indicator is driven by actual capture activity and never becomes permanent decoration.

Panel toggles re-fit the selected screen to the remaining board, or preserve the camera center when nothing is selected. Search and panel visibility never mutate the document or add undo entries.
