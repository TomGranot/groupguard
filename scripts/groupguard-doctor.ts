#!/usr/bin/env node
import { inspectInstallation } from '../src/groupguard/operations.js';

const report = await inspectInstallation({ projectRoot: process.cwd() });
for (const check of report.checks) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.id.padEnd(14)} ${check.detail}`);
}
console.log(
  report.ready ? 'GroupGuard is ready.' : 'GroupGuard is not ready. Fix failed checks before starting the service.',
);
if (!report.ready) process.exitCode = 1;
