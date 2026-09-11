import { detectProjectAdapter } from "./adapters/index";
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installedDevelopmentTeams } from './signing';
import { createInterface } from 'node:readline/promises';
import { stdin, stderr } from 'node:process';
import { inspectEnvironment } from './environment';
import { saveSigningTeam, dataDirectory, cacheDirectory } from './installation';
import { appDependencies } from './adapters/expo/app-dependencies';

export function formatEnvironment(report: Awaited<ReturnType<typeof inspectEnvironment>>, currentRoot = false) {
  return ['Mobile Canvas · Mac setup', '', ...report.checks.flatMap(check => [
    `${check.status === 'ready' ? '✓' : check.status === 'missing' ? '✗' : '·'} ${check.detail}`,
    ...(check.action ? [`  ${check.action}`] : []),
  ]), '', 'Expo is installed per app; no global Expo CLI is needed.',
    'Tool downloads: Xcode — https://developer.apple.com/xcode/ · CocoaPods — https://guides.cocoapods.org/using/getting-started.html · Bun — https://bun.sh/',
    `Settings: ${dataDirectory}`, `Shared cache: ${cacheDirectory}`,
    report.readyToBuild ? (currentRoot ? 'Ready to build. Run mobile-canvas open from this directory.' : 'Ready to build. Run mobile-canvas open from your app directory, or pass --app /path/to/app.') : 'Finish the missing steps, then run setup again.',
  ].join('\n');
}

/** Explicit setup action: installs dependencies using the app's frozen lockfile. */
export async function installAppDependencies(app: string) {
  const dependencies = await appDependencies(app);
  if (!dependencies.installArgs) throw new Error('Automatic dependency setup requires an npm or Bun lockfile. Install this app with its own package manager, then rerun setup.');
  console.error(`Installing app dependencies with ${dependencies.installArgs.join(' ')}…`);
  const [command, ...args] = dependencies.installArgs;
  const child = spawn(command, args, { cwd: app, stdio: ['inherit', 'inherit', 'inherit'] });
  return await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

export async function setup(options: { app?: string; project?: string; offline?: boolean; team?: string; install?: boolean; json?: boolean }) {
  if (options.install && options.json) throw new Error('Use --install without --json; package managers write their own output.');
  if (options.project && !options.app) {
    const { document } = JSON.parse(await readFile(join(options.project, 'expo-canvas.json'), 'utf8'));
    if ((document.appPreview || document.nativePreview) && document.origin?.mode === 'linked') {
      options.app = document.origin.path;
      options.offline ??= document.appPreview?.offline;
    }
  }
  if (options.install && !options.app) throw new Error('Use setup --install --app /path/to/app to download its dependencies.');
  if (options.team) await saveSigningTeam(options.team);
  let report = await inspectEnvironment(options);
  if (!options.json && report.checks.find(check => check.id === 'signing-team')?.status === 'missing') {
    const teams = options.team ? [] : await installedDevelopmentTeams();
    if (teams.length === 1) {
      await saveSigningTeam(teams[0]);
      console.error('Using the development team already configured on this Mac.');
      report = await inspectEnvironment(options);
    } else if (stdin.isTTY) {
      const terminal = createInterface({ input: stdin, output: stderr });
      try {
        console.error('Canvas builds an iOS renderer for this Mac. Xcode needs a development team to sign it; an Expo login is separate.');
        if (teams.length) console.error(teams.map((team, index) => `  ${index + 1}. ${team}`).join('\n'));
        else console.error('Add your Apple account in Xcode Settings → Accounts and configure development signing.');
        const answer = (await terminal.question(teams.length ? 'Choose a team number or enter its ID (Return to skip): ' : 'Apple Team ID, if known (Return to skip): ')).trim();
        const team = /^\d+$/.test(answer) && teams[Number(answer) - 1] || answer;
        if (team) { await saveSigningTeam(team); report = await inspectEnvironment(options); }
      } finally { terminal.close(); }
    } else if (teams.length > 1) {
      console.error('Multiple development teams are available. Run setup in a terminal to choose one, or pass --team YOURTEAMID.');
    }
  }
  if (options.install && await detectProjectAdapter(options.app!) !== "swift-ios") {
    const code = await installAppDependencies(options.app!);
    report = await inspectEnvironment(options);
    if (code) {
      console.error('The package manager reported a failure. Check its output above.');
      // Explicit offline previews can proceed without supported private/service packages.
      if (!report.readyToBuild) process.exitCode = 1;
      else console.error('The dependencies required for this selected preview are nevertheless installed.');
    }
  }
  return report;
}
