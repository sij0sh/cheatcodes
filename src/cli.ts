#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { projectStatus, runWorker } from "./run.js";

function usage(): string {
  return "Usage:\n  cheatcodes run\n  cheatcodes status";
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    if (!command) process.exitCode = 2;
    return;
  }
  if (rest.length > 0) {
    console.error(`cheatcodes ${command} takes no options or arguments`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (command === "run" || command === "auto") {
    const result = await runWorker();
    if (result.outcome === "failed" || result.outcome === "timeout") {
      console.error(`cheatcodes ${command}: ${result.outcome}${result.reason ? `: ${result.reason}` : ""}`);
      process.exitCode = 1;
      return;
    }
    if (result.run) {
      for (const warning of result.run.warnings) console.warn(`warning: ${warning}`);
      console.log(`Processed ${result.run.changedFiles} changed file(s), ${result.run.curatorCalls} curator call(s), ${result.run.entriesWritten} entry write(s).`);
    } else {
      console.log(`cheatcodes ${command}: ${result.outcome}${result.reason ? ` (${result.reason})` : ""}`);
    }
  } else if (command === "status") {
    const result = await projectStatus();
    console.log(`Project ${result.projectKey} at ${result.root}`);
    console.log(`Inputs: ${result.discoveredFiles} session file(s) discovered, ${result.skipped.length} skipped, ${result.missingInputs.length} missing input(s).`);
    console.log(`Entries: ${result.entries} in ${result.knowledgeFile}.`);
    if (result.lastRun) {
      console.log(`Last run: ${result.lastRun.outcome}${result.lastRun.reason ? ` (${result.lastRun.reason})` : ""} at ${result.lastRun.finishedAt}.`);
    } else {
      console.log("Last run: none recorded.");
    }
  } else {
    console.error(`cheatcodes: unknown command "${command}"`);
    console.error(usage());
    process.exitCode = 2;
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) main().catch((error) => { console.error(`cheatcodes: ${(error as Error).message}`); process.exitCode = 1; });
