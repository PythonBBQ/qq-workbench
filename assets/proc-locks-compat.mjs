// Android hides the global lock table. Reconstruct its entries from the kernel's
// per-fd lock records for this app's unchanged official QQ executable only.
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';

export async function readQqLocks(io = fs) {
  const [self, executable, signals] = await Promise.all([
    io.stat('/proc/self'), io.stat('/opt/QQ/qq'), io.readdir('/tmp/qqwb-runtime'),
  ]);
  // The app's loader/pipe files identify candidates. Scanning every Android
  // process under proot is expensive; these are still verified below.
  const entries = [...new Set(signals.map(name => /^(?:mojo\.([1-9][0-9]*)\.control\.sock|qqwb-snow-status-([1-9][0-9]*))$/.exec(name)).filter(Boolean).map(m => m[1] || m[2]))];
  const lines = new Set();
  for (const pid of entries.filter(p => /^[1-9][0-9]*$/.test(p))) {
    try {
      const owner = await io.stat(`/proc/${pid}`);
      if (owner.uid !== self.uid) continue;
      const command = (await io.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
      if (command[0] !== '/opt/QQ/qq' || command.some(arg => arg.startsWith('--type='))) continue;
      // proot exposes its loader as /proc/pid/exe. Match the real executable's
      // mapped inode/device instead, never just a process name or cached account.
      const major = (executable.dev >> 8) & 0xfff;
      const minor = (executable.dev & 0xff) | ((executable.dev >> 12) & 0xfff00);
      const maps = await io.readFile(`/proc/${pid}/maps`, 'utf8');
      const official = maps.split('\n').some(line => {
        const f = line.trim().split(/\s+/), device = (f[3] || '').split(':');
        return f[1]?.includes('x') && Number(f[4]) === executable.ino &&
          parseInt(device[0],16) === major && parseInt(device[1],16) === minor &&
          /^(?:\/data\/(?:data|user\/0)\/cn\.qqworkbench\.assistant\/files\/linux\/rootfs)?\/opt\/QQ\/qq$/.test(f[5] || '');
      });
      if (!official) continue;
      for (const fd of await io.readdir(`/proc/${pid}/fdinfo`)) {
        if (!/^\d+$/.test(fd)) continue;
        let text;
        try { text = await io.readFile(`/proc/${pid}/fdinfo/${fd}`, 'utf8'); }
        catch (e) { if (e.code === 'ENOENT') continue; throw e; }
        for (const raw of text.split('\n')) {
          if (!raw.startsWith('lock:')) continue;
          const line = raw.slice(5).trim(), fields = line.split(/\s+/);
          // Preserve the actual device/inode, owner PID and byte ranges.
          if (fields.length >= 8 && fields[1] === 'POSIX' && fields[4] === pid) lines.add(line);
        }
      }
    } catch (e) {
      if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(e.code)) throw e;
    }
  }
  return [...lines].join('\n') + '\n';
}

export function installProcLocksCompatibility(io = fs, collect = () => readQqLocks(io)) {
  if (io.readFile.qqwbProcLocks) return;
  const original = io.readFile.bind(io);
  let snapshot = null, expires = 0;
  const wrapped = async function(file, options) {
    try { return await original(file, options); }
    catch (error) {
      if (file !== '/proc/locks' || !['EACCES', 'EPERM'].includes(error.code)) throw error;
      if (!snapshot || Date.now() >= expires) {
        expires = Date.now() + 1000;
        snapshot = collect();
        snapshot.catch(() => { snapshot = null; });
      }
      const table = await snapshot;
      const encoding = typeof options === 'string' ? options : options?.encoding;
      return encoding ? Buffer.from(table).toString(encoding) : Buffer.from(table);
    }
  };
  wrapped.qqwbProcLocks = true;
  io.readFile = wrapped;
  syncBuiltinESMExports();
}

if (process.env.QQWB_PROC_LOCKS_FDINFO === '1') installProcLocksCompatibility();
