#!/usr/bin/env node
const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 22) {
  console.error(`gen-ai requires Node.js 22 or later. You have v${process.versions.node}.`);
  console.error('Download from https://nodejs.org/');
  process.exit(1);
}
import { main } from "../cli.js";
main().catch((err) => { console.error(err); process.exit(1); });
