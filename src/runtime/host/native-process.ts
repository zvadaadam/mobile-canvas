/** Locate only the native app launched for this canvas session, even before its first receipt. */
export function nativeProcessForHost(processList: string, executable: string, hostId: string): number | undefined {
  const row = processList.split('\n').find(line =>
    line.includes(`/${executable}.app/${executable} `) && line.trimEnd().endsWith(`--host-id ${hostId}`));
  const pid = row && Number(row.trim().split(/\s+/)[0]);
  return pid && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}
