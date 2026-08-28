#!/usr/bin/env node
/**
 * Terminate whatever is listening on a TCP port.
 *
 * The end-to-end harness starts its own server and refuses to reuse an existing
 * one, because a leftover process from an earlier run serves a stale build —
 * which presents as every page rendering the error boundary rather than as an
 * obvious port conflict. This makes clearing the port a single explicit step.
 *
 *   node scripts/free-port.mjs 3100
 *
 * Reads /proc directly rather than shelling out to lsof or ss, neither of which
 * is guaranteed to be installed in a slim container.
 */

import fs from "node:fs";
import path from "node:path";

const port = Number(process.argv[2] ?? process.env.E2E_PORT ?? 3100);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Usage: node scripts/free-port.mjs <port>  (got "${process.argv[2]}")`);
  process.exit(1);
}

/** Inode numbers of sockets LISTENing on the given port. */
function listeningInodes() {
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let lines;
    try {
      lines = fs.readFileSync(file, "utf8").split("\n").slice(1);
    } catch {
      continue;
    }
    for (const line of lines) {
      const fields = line.trim().split(/\s+/);
      // st === "0A" is TCP_LISTEN.
      if (fields.length < 10 || fields[3] !== "0A") continue;
      const localPort = parseInt(fields[1].split(":")[1], 16);
      if (localPort === port) inodes.add(fields[9]);
    }
  }
  return inodes;
}

function pidsHoldingInodes(inodes) {
  if (inodes.size === 0) return [];
  const pids = [];

  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;

    const fdDir = path.join("/proc", entry, "fd");
    let fds;
    try {
      fds = fs.readdirSync(fdDir);
    } catch {
      continue; // not ours, or already exited
    }

    for (const fd of fds) {
      let link;
      try {
        link = fs.readlinkSync(path.join(fdDir, fd));
      } catch {
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(link);
      if (match && inodes.has(match[1])) {
        let cmd = "unknown";
        try {
          cmd = fs
            .readFileSync(path.join("/proc", entry, "cmdline"), "utf8")
            .replace(/\0/g, " ")
            .trim()
            .slice(0, 80);
        } catch {
          /* process exited between calls */
        }
        pids.push({ pid, cmd });
        break;
      }
    }
  }
  return pids;
}

const inodes = listeningInodes();
if (inodes.size === 0) {
  console.log(`Port ${port} is free.`);
  process.exit(0);
}

const holders = pidsHoldingInodes(inodes);
if (holders.length === 0) {
  console.log(
    `Port ${port} is in use but the owning process is not visible from this ` +
      "container. Choose another port with E2E_PORT.",
  );
  process.exit(1);
}

for (const { pid, cmd } of holders) {
  console.log(`Terminating pid ${pid} on port ${port}: ${cmd}`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

// Give them a moment to release the socket, then escalate if needed.
await new Promise((resolve) => setTimeout(resolve, 2000));

if (listeningInodes().size > 0) {
  for (const { pid } of holders) {
    try {
      process.kill(pid, "SIGKILL");
      console.log(`Escalated to SIGKILL for pid ${pid}.`);
    } catch {
      /* already gone */
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

console.log(listeningInodes().size === 0 ? `Port ${port} is now free.` : `Port ${port} is still busy.`);
