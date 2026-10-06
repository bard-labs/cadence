# ADR-011: Studio is opt-in so iPhone Safari can keep background HLS

**Context:** Cadence is a website, not a native app. On iPhone Safari, leaving the tab (without killing Safari) should keep music in the Dynamic Island / lock screen. That path needs **native HLS** on the `<audio>` element, plus Media Session metadata.

Web Audio (`createMediaElementSource`) is required for a real equalizer, reverb, 8D pan, and analyser-driven visuals. On Safari, once the element is routed through Web Audio, background playback often goes silent, and MediaElementSource can return silence for native HLS.

**Decision:**

- Studio (EQ / effects) and reactive visualizers are **off by default**.
- While they are off, Safari and iOS use native HLS. Media Session gets title, artist, album, cover, and position, plus seek handlers.
- Turning Studio or a visualizer on builds a Web Audio graph. The user is warned on Apple that background / Dynamic Island may pause until Studio is turned off.
- Tempo (slowed / nightcore) is host-only and published as `rate` on room state, so listeners stay in sync. Reverb, EQ, and 8D are local colour — friends still hear the clean HLS stream.

**Consequences:** The "sexier than Spotify" layer is real in the browser, and the LinkedIn demo still works on an iPhone when Studio stays off.
