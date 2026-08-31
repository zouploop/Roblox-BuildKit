import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const NETSTAT_MAX_BUFFER = 2_000_000;
const BUILD_MAX_BUFFER = 16_000_000;

export type ListenerPid = number | null;

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError(`invalid TCP port: ${port}`);
  }
}

function assertPid(pid: number, label: string): void {
  if (!Number.isInteger(pid) || pid < 1) {
    throw new RangeError(`invalid ${label} PID: ${pid}`);
  }
}

function portOfEndpoint(endpoint: string): number | null {
  const match = endpoint.startsWith("[")
    ? /^\[[^\]]+\]:(\d+)$/.exec(endpoint)
    : /:(\d+)$/.exec(endpoint);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

// Reads the TCP LISTENING rows from `netstat -ano`. Multiple address-family rows
// are normal when they belong to the same PID; conflicting PIDs are unsafe to guess.
export function parseNetstatListenerPid(output: string, port: number): ListenerPid {
  assertPort(port);
  const pids = new Set<number>();

  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[0].toUpperCase() !== "TCP" || fields[3].toUpperCase() !== "LISTENING") {
      continue;
    }
    if (portOfEndpoint(fields[1]) !== port) continue;

    if (!/^\d+$/.test(fields[4])) {
      throw new Error(`netstat returned a non-numeric listener PID: ${fields[4]}`);
    }
    const pid = Number(fields[4]);
    assertPid(pid, "listener");
    pids.add(pid);
  }

  if (pids.size > 1) {
    throw new Error(`multiple listener PIDs found for port ${port}: ${[...pids].join(", ")}`);
  }
  return pids.size === 1 ? [...pids][0] : null;
}

export type NetstatReader = (port: number) => Promise<string>;

async function readNetstat(): Promise<string> {
  const result = await execFileAsync("netstat", ["-ano"], {
    windowsHide: true,
    maxBuffer: NETSTAT_MAX_BUFFER,
  });
  return result.stdout;
}

export async function findListenerPid(port: number, reader: NetstatReader = async () => readNetstat()): Promise<ListenerPid> {
  return parseNetstatListenerPid(await reader(port), port);
}

export type StalePidDecision = {
  listenerPid: ListenerPid;
  currentPid: number;
  stalePid: ListenerPid;
  action: "none" | "self" | "replace";
};

export function decideStalePid(listenerPid: ListenerPid | undefined, currentPid: number): StalePidDecision {
  assertPid(currentPid, "current process");
  const normalized = listenerPid ?? null;
  if (normalized === null) {
    return { listenerPid: null, currentPid, stalePid: null, action: "none" };
  }

  assertPid(normalized, "listener");
  if (normalized === currentPid) {
    return { listenerPid: normalized, currentPid, stalePid: null, action: "self" };
  }
  return { listenerPid: normalized, currentPid, stalePid: normalized, action: "replace" };
}

export type ProcessCommand = {
  file: string;
  args: string[];
  cwd: string;
  shell: false;
  windowsHide: boolean;
};

export type DetachedStartCommand = ProcessCommand & {
  detached: true;
  stdio: "ignore";
};

export type DetachedRestartCommand = {
  platform: NodeJS.Platform;
  cwd: string;
  port: number;
  currentPid: number;
  stalePid: number;
  nodeExecutable: string;
  entrypoint: string;
  build: ProcessCommand;
  terminate: { pid: number };
  start: DetachedStartCommand;
};

export type DetachedRestartOptions = {
  cwd: string;
  port?: number;
  stalePid: number;
  currentPid?: number;
  platform?: NodeJS.Platform;
  nodeExecutable?: string;
  entrypoint?: string;
};

function basenameAny(file: string): string {
  return file.replace(/^.*[\\/]/, "").toLowerCase();
}

function isInside(base: string, candidate: string): boolean {
  const relative = path.relative(base, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function sameArgs(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

export function validateDetachedRestartCommand(command: DetachedRestartCommand): void {
  if (!command || typeof command !== "object") throw new TypeError("restart command is required");
  if (!path.isAbsolute(command.cwd)) throw new Error("restart cwd must be absolute");
  assertPort(command.port);
  assertPid(command.currentPid, "current process");
  assertPid(command.stalePid, "stale");
  if (command.stalePid === command.currentPid) {
    throw new Error("refusing to terminate the current process");
  }
  if (!command.nodeExecutable || !command.entrypoint) throw new Error("restart command is missing its executable or entrypoint");
  if (path.isAbsolute(command.entrypoint) || !isInside(command.cwd, path.resolve(command.cwd, command.entrypoint))) {
    throw new Error("restart entrypoint must stay inside cwd");
  }

  if (command.build.cwd !== command.cwd || command.start.cwd !== command.cwd) {
    throw new Error("build and start commands must use the restart cwd");
  }
  if (command.terminate.pid !== command.stalePid) throw new Error("terminate PID does not match stale PID");
  if (command.build.shell !== false || command.start.shell !== false) throw new Error("restart commands may not use a shell");

  const expectedBuildArgs = command.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd", "run", "build"]
    : ["run", "build"];
  const expectedBuildFile = command.platform === "win32" ? "cmd.exe" : "npm";
  if (basenameAny(command.build.file) !== expectedBuildFile || !sameArgs(command.build.args, expectedBuildArgs)) {
    throw new Error("restart must rebuild with npm run build before replacing the process");
  }
  if (command.start.file !== command.nodeExecutable || !sameArgs(command.start.args, [command.entrypoint])) {
    throw new Error("restart must start the validated BuildKit entrypoint with Node");
  }
  if (command.start.detached !== true || command.start.stdio !== "ignore") {
    throw new Error("replacement process must be detached with ignored stdio");
  }
  if (!command.build.windowsHide || !command.start.windowsHide) {
    throw new Error("restart child processes must hide Windows consoles");
  }
}

export function buildDetachedRestartCommand(options: DetachedRestartOptions): DetachedRestartCommand {
  const currentPid = options.currentPid ?? process.pid;
  const decision = decideStalePid(options.stalePid, currentPid);
  if (decision.action !== "replace" || decision.stalePid === null) {
    throw new Error("refusing to replace the current BuildKit process");
  }

  const platform = options.platform ?? process.platform;
  const cwd = options.cwd;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const entrypoint = options.entrypoint ?? path.join("dist", "index.js");
  const build: ProcessCommand = platform === "win32"
    ? {
        file: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", "npm.cmd", "run", "build"],
        cwd,
        shell: false,
        windowsHide: true,
      }
    : {
        file: "npm",
        args: ["run", "build"],
        cwd,
        shell: false,
        windowsHide: true,
      };
  const command: DetachedRestartCommand = {
    platform,
    cwd,
    port: options.port ?? 8_642,
    currentPid,
    stalePid: decision.stalePid,
    nodeExecutable,
    entrypoint,
    build,
    terminate: { pid: decision.stalePid },
    start: {
      file: nodeExecutable,
      args: [entrypoint],
      cwd,
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    },
  };
  validateDetachedRestartCommand(command);
  return command;
}

export type DetachedRestartRuntime = {
  rebuild: (command: ProcessCommand) => Promise<void>;
  readListenerPid: (port: number) => Promise<ListenerPid>;
  terminate: (pid: number) => void | Promise<void>;
  start: (command: DetachedStartCommand) => number | undefined | Promise<number | undefined>;
};

async function rebuild(command: ProcessCommand): Promise<void> {
  await execFileAsync(command.file, command.args, {
    cwd: command.cwd,
    windowsHide: command.windowsHide,
    maxBuffer: BUILD_MAX_BUFFER,
  });
}

function terminate(pid: number): void {
  assertPid(pid, "stale");
  if (pid === process.pid) throw new Error("refusing to terminate the current process");
  process.kill(pid);
}

function startDetached(command: DetachedStartCommand): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      cwd: command.cwd,
      shell: command.shell,
      detached: command.detached,
      stdio: command.stdio,
      windowsHide: command.windowsHide,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve(child.pid);
    });
  });
}

const defaultRuntime: DetachedRestartRuntime = {
  rebuild,
  readListenerPid: findListenerPid,
  terminate,
  start: startDetached,
};

export type DetachedRestartResult = {
  stalePid: number;
  terminated: boolean;
  newPid: number | undefined;
};

export async function runDetachedRestart(
  command: DetachedRestartCommand,
  runtime: DetachedRestartRuntime = defaultRuntime,
): Promise<DetachedRestartResult> {
  validateDetachedRestartCommand(command);
  await runtime.rebuild(command.build);

  // The build can take long enough for the old process to exit or for another
  // process to claim the port. Never kill a PID that no longer owns the listener.
  const listenerPid = await runtime.readListenerPid(command.port);
  if (listenerPid !== null && listenerPid !== command.stalePid) {
    if (listenerPid === command.currentPid) throw new Error("listener is the current process; refusing to terminate it");
    throw new Error(`listener changed during rebuild (${command.stalePid} -> ${listenerPid}); refusing to terminate it`);
  }

  let terminated = false;
  if (listenerPid === command.stalePid) {
    await runtime.terminate(command.stalePid);
    terminated = true;
  }
  const newPid = await runtime.start(command.start);
  return { stalePid: command.stalePid, terminated, newPid };
}
