import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomically } from '../atomic-file';

/** Expo's Constants build phase splits paths containing spaces in SDK 54/56/57. */
export function quoteConstantsPaths(source: string) {
  return source
    .replace(/^    :script => .*get-app-config-ios\.sh.*,$/m,
      '    :script => \'bash -l "$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh"\',')
    .replace('$(basename $PROJECT_DIR)', '$(basename "$PROJECT_DIR")');
}

/** Ruby's file URI builder requires escaped paths (RN prebuilt downloads). */
export function escapePrebuiltPaths(source: string) {
  return source.replaceAll('URI::File.build(path: destinationDebug)',
    'URI::File.build(path: URI::DEFAULT_PARSER.escape(destinationDebug))');
}

export async function prepareBuildScripts(host: string) {
  let changed = false;
  const patches: [string, (source: string) => string][] = [
    ...['ios/EXConstants.podspec', 'scripts/get-app-config-ios.sh'].map(file =>
      [`expo-constants/${file}`, quoteConstantsPaths] as [string, typeof quoteConstantsPaths]),
    ...['rncore.rb', 'rndependencies.rb'].map(file =>
      [`react-native/scripts/cocoapods/${file}`, escapePrebuiltPaths] as [string, typeof escapePrebuiltPaths]),
  ];
  for (const [file, patch] of patches) {
    const target = join(host, 'node_modules', file);
    let source: string;
    try { source = await readFile(target, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const updated = patch(source);
    if (updated !== source) { await writeFileAtomically(target, updated); changed = true; }
  }
  return changed;
}
