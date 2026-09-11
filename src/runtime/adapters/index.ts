import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CanvasDocument, Session } from '../../shared/model';
import { authoredHostPaths } from '../installation';
import { prepareMatchedHost, matchedHostPaths } from '../host/matched';
import { prepareSwiftHost, swiftHostPaths } from './swift/build';
import { swiftProjectCandidates } from './swift/project';

interface HostPaths { host: string; output: string }
export interface ProjectAdapter {
  id: 'expo' | 'swift-ios';
  usesMetro: boolean;
  paths(project: string, document: CanvasDocument): HostPaths;
  prepare(session: Session, signal?: AbortSignal): Promise<HostPaths>;
}

const expo: ProjectAdapter = {
  id: 'expo', usesMetro: true,
  paths: (project, document) => document.appPreview ? matchedHostPaths(project) : authoredHostPaths,
  async prepare(session, signal) {
    const {appPreview, origin} = session.project.document;
    return appPreview && origin?.mode === 'linked'
      ? prepareMatchedHost(session.directory, origin.path, signal)
      : authoredHostPaths;
  },
};
const swift: ProjectAdapter = {
  id: 'swift-ios', usesMetro: false,
  paths: project => swiftHostPaths(project),
  prepare: prepareSwiftHost,
};
export const adapterForDocument = (document: CanvasDocument): ProjectAdapter => document.nativePreview ? swift : expo;

export async function detectProjectAdapter(directory: string): Promise<'expo' | 'swift-ios' | undefined> {
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '{}'; throw error;
  }));
  if (pkg.dependencies?.expo || pkg.devDependencies?.expo) return 'expo';
  if ((await swiftProjectCandidates(directory)).length) return 'swift-ios';
}
