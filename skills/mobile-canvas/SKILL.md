---
name: mobile-canvas
description: Explore and edit mobile interfaces in Mobile Canvas on a Mac. Use for an app's screen map, navigation flow, native screen screenshots, preview states, or comparing Expo and experimental Swift designs on the canvas.
---

# Mobile Canvas

Load the workflow from the installed product before using it, so instructions match its version:

```sh
mobile-canvas skills get core
```

For source edits, fixtures and transaction examples, use `mobile-canvas skills get core --full`.
List available guidance with `mobile-canvas skills list`.

With an attached Mobile Canvas MCP server, call `canvas_read_skill` with `name: "core"` instead. Pass `full: true` for the editing reference. The core workflow is also an MCP resource at `mobile-canvas://skills/core`.

The workflow covers choosing a screen from the sitemap, inspecting its native pixels without clicking through a Simulator, making a reviewable experiment, and distinguishing preview limitations from app bugs. Use it within the user's requested scope.
