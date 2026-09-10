import { X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

/** Match public certificates to valid identities; CN's suffix is not the Team ID. */
export function developmentTeams(identities: string, certificates: string): string[] {
  const hashes = new Set([...identities.matchAll(/\b([A-Fa-f0-9]{40})\s+"(?:Apple Development|iPhone Developer):[^"\n]+"/g)].map(match => match[1].toUpperCase()));
  const teams = new Set<string>();
  for (const pem of certificates.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []) {
    try {
      const cert = new X509Certificate(pem);
      if (!hashes.has(cert.fingerprint.replaceAll(':', '').toUpperCase())) continue;
      const team = cert.subject.match(/(?:^|\n)OU=([A-Z0-9]{10})(?:\n|$)/)?.[1];
      if (team) teams.add(team);
    } catch { /* Ignore unrelated malformed public certificates. */ }
  }
  return [...teams].sort();
}

export async function installedDevelopmentTeams(): Promise<string[]> {
  if (process.platform !== 'darwin') return [];
  try {
    const [identities, certificates] = await Promise.all([
      run('security', ['find-identity', '-v', '-p', 'codesigning'], { timeout: 10_000 }),
      run('security', ['find-certificate', '-a', '-p'], { timeout: 10_000, maxBuffer: 4_000_000 }),
    ]);
    return developmentTeams(identities.stdout, certificates.stdout);
  } catch { return []; }
}
