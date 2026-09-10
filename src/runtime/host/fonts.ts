/** Expo's process-wide font aliases are shared by otherwise isolated React roots.
 * Re-registering a font must not temporarily remove it while another root lays out text.
 * Applied only to the generated host's dependency, never to the linked app.
 */
export function sharedFontLoader(source: string) {
  if (source.includes("canvasFontLock")) return source;
  const start = '      let fontUrl = localUri as CFURL';
  const end = '      // Register the font';
  const from = source.indexOf(start), to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error('This expo-font loader is not supported by the multi-screen host. Its registration API has changed.');
  return source.replace('import ExpoModulesCore', `import ExpoModulesCore

private let canvasFontLock = NSLock()
private var canvasFonts = [String: (Data, String)]()`)
    .replace(source.slice(from, to), `      canvasFontLock.lock()
      defer { canvasFontLock.unlock() }
      let bytes = try Data(contentsOf: localUri)
      if let existing = canvasFonts[fontFamilyAlias] {
        guard existing.0 == bytes else {
          throw NSError(domain: "ExpoCanvas", code: 1, userInfo: [NSLocalizedDescriptionKey: "Font \\(fontFamilyAlias) changed. Reopen the canvas to load the new font safely."])
        }
        registeredFonts = Array(Set(registeredFonts).union([existing.1, fontFamilyAlias]))
        return
      }
      let fontUrl = localUri as CFURL

`)
    .replace('FontFamilyAliasManager.setAlias(fontFamilyAlias, forFont: postScriptName)', 'FontFamilyAliasManager.setAlias(fontFamilyAlias, forFont: postScriptName)\n        canvasFonts[fontFamilyAlias] = (bytes, postScriptName)');
}
