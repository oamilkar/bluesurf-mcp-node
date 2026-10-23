#!/usr/bin/env node
import { main } from "./cli.js";

main(process.argv.slice(2)).then(
  (code) => {
    if (typeof code === "number") process.exit(code);
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  },
);
