import { detectProjectAdapter } from "./adapters/index";
import { loadSwiftProject } from './adapters/swift/project';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repository } from './paths';
import { signingTeam } from './installation';
import { appDependencies } from './app-dependencies';
import { createRequire } from 'node:module';
const { excluded, iconPackages } = createRequire(import.meta.url)(join(repository, 'apps/linked-host/design/environment.cjs')) as { excluded: string[]; iconPackages: string[] };
const execute = promisify(execFile);
type Probe = (command: string, args: string[]) => Promise<string | null>;
const probe: Probe = async (command, args) => {
  try { return (await execute(command, args, { timeout: 10_000, maxBuffer: 100_000 })).stdout.trim(); }
  catch { return null; }
};
export type EnvironmentCheck = { id: string; status: 'ready' | 'missing' | 'manual'; detail: string; action?: string };

/** Read-only installation diagnostics. Never installs tools, accepts licenses or changes signing. */
export async function inspectEnvironment(options: { app?: string; project?: string; offline?: boolean } = {}, system: { platform: string; arch: string; node: string; team?: string; probe: Probe } = { platform: process.platform, arch: process.arch, node: process.versions.node, team: process.env.EXPO_CANVAS_DEVELOPMENT_TEAM, probe }) {
  const checks: EnvironmentCheck[] = [];
  const swift = options.app ? await detectProjectAdapter(options.app).then(x=>x === "swift-ios",()=>false) : false;
  const add = (id: string, ready: boolean, detail: string, action: string) => checks.push({ id, status: ready ? 'ready' : 'missing', detail, ...(!ready ? { action } : {}) });
  add('mac', system.platform === 'darwin' && system.arch === 'arm64', `${system.platform} / ${system.arch}`, 'Native Canvas requires an Apple-silicon Mac. On Apple silicon, use an arm64 Node installation rather than Rosetta.');
  const [major, minor] = system.node.split('.').map(Number);
  add('node', major > 22 || major === 22 && minor >= 14, `Node ${system.node}`, 'Install Node 22.14 or newer.');
  const results = await Promise.all(['xcode', 'first-launch', 'pods', 'signing'].map(async id => {
    if (system.platform !== 'darwin') return null;
    return id === 'xcode' ? system.probe('xcodebuild', ['-version']) : id === 'first-launch' ? system.probe('xcodebuild', ['-checkFirstLaunchStatus']) : id === 'pods' ? system.probe('pod', ['--version']) : system.probe('security', ['find-identity', '-v', '-p', 'codesigning']);
  }));
  const xcode = results[0]?.match(/^Xcode (\d+)(?:\.(\d+))?/m);
  let app: Awaited<ReturnType<typeof appDependencies>> | undefined;
  if (options.app && !swift) {
    try { app = await appDependencies(options.app); }
    catch { checks.push({ id: 'app', status: 'missing', detail: 'Cannot read the app package manifest.', action: 'Pass --app with a readable Expo app directory.' }); }
  }
  if (swift) {
    checks.push({id:"swift-project",status:"ready",detail:"Native Swift project detected. Expo and CocoaPods are not required by the Swift adapter."});
    if (system.platform === 'darwin') {
      try {
        const spec = await loadSwiftProject(options.app!);
        if (spec.buildIssues?.length) checks.push({id:'swift-build-integration',status:'manual',
          detail:'Canvas can display the source map, but cannot yet build this app’s live previews.',
          action:spec.buildIssues.join('\n')});
        if (spec.buildInputs?.some(path=>path.endsWith('.metal')) || spec.buildIssues?.some(issue=>/\.metal\b/.test(issue))) {
          const metal = await system.probe('xcrun',['metal','--version']);
          add('metal-toolchain',metal !== null,metal !== null ? 'Metal compiler is installed.' : 'This app contains Metal shaders, but the Metal compiler is unavailable.',
            'Install the Xcode component with: xcodebuild -downloadComponent MetalToolchain. This enables shader compilation; Canvas build integration is a separate requirement.');
        }
      } catch (error) { checks.push({id:'swift-project-build',status:'manual',detail:`Could not inspect the Xcode target: ${(error as Error).message}`}); }
    }
  }
  const sdk = Number(app?.installedExpo?.split('.')[0]);
  const minimumMinor = sdk === 57 ? 4 : 0;
  add('xcode', !!xcode && (Number(xcode[1]) > 26 || Number(xcode[1]) === 26 && Number(xcode[2] ?? 0) >= minimumMinor), xcode?.[0] ?? 'Full Xcode is unavailable to the command line.', `Install compatible Xcode (26${minimumMinor ? '.4' : ''} or newer), open it once, and select it in Xcode Settings → Locations → Command Line Tools. SDK and package requirements may be stricter.`);
  add('xcode-first-launch', results[1] !== null, results[1] !== null ? 'Xcode first-launch setup is complete.' : 'Xcode first-launch setup has not passed.', 'Open Xcode and finish its license, components and first-launch setup.');
  if (!swift) add('cocoapods', results[2] !== null, results[2] ? `CocoaPods ${results[2].split('\n').at(-1)}` : 'CocoaPods is not available.', 'Install CocoaPods and make the pod command available in PATH.');
  const hasIdentity = /"Apple Development:|"iPhone Developer:/.test(results[3] ?? '');
  checks.push({ id: 'signing-identity', status: hasIdentity ? 'ready' : 'manual', detail: hasIdentity ? 'A development signing identity is available.' : 'No available development signing identity was found.', ...(!hasIdentity ? { action: 'Add your Apple account in Xcode Settings → Accounts and configure development signing. Xcode may create the identity during the first build.' } : {}) });
  const team = system.team ?? await signingTeam(options.project);
  add('signing-team', !!team && /^[A-Z0-9]{10}$/.test(team), team ? (/^[A-Z0-9]{10}$/.test(team) ? 'Development team configured.' : 'Development team format is invalid.') : 'No development team configured.', 'Run expo-canvas setup --team YOURTEAMID to save your Apple team ID, or set EXPO_CANVAS_DEVELOPMENT_TEAM. Your credentials stay in Xcode.');
  if (app) {
    add('app-sdk', sdk === 56 || sdk === 57, app.installedExpo ? `Installed Expo ${app.installedExpo}` : 'Expo is not installed in the app.', 'Automatic linked native previews currently support Expo 56 and 57. Install the app dependencies; other SDKs can still use source-only mapping.');
    const missing = app.missing.filter(name => !options.offline || ![...excluded, ...iconPackages].includes(name));
    add('app-dependencies', !missing.length, missing.length ? `Missing: ${missing.join(', ')}` : 'Required direct app dependencies are installed.', `Run ${app.install} in the source app. Resolve any private package access there; do not put tokens in Canvas metadata.`);
    const needsBun = app.install.startsWith('bun ') || Object.keys(JSON.parse(await readFile(join(options.app!, 'package.json'), 'utf8')).patchedDependencies ?? {}).length > 0;
    if (needsBun) add('bun', await system.probe('bun', ['--version']) !== null, 'This app uses Bun or Bun package patches.', 'Install Bun and make it available in PATH.');
  }
  checks.push({ id: 'native-build', status: 'manual', detail: 'These checks do not prove provisioning, native compilation, service access or rendered pixels.', action: 'Open the app to build and verify its native preview. macOS may request Screen Recording access for capture fallback.' });
  return { readyToBuild: checks.every(check => check.status !== 'missing'), checks, sourceOnlyAvailable: checks.find(check => check.id === 'node')?.status === 'ready' };
}
