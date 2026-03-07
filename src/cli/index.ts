import { createProgram } from './program.js';
import { handleCommandError } from './utils.js';

const program = createProgram();

// Avoid a bare top-level await. Node.js v20+ emits a spurious
// "Warning: Detected unsettled top-level await" when an async action
// (e.g. Inquirer prompt cancelled via EOF/SIGINT) causes the event loop
// to drain before parseAsync resolves — making output look like duplicate
// errors. Wrapping in a non-awaited .catch() keeps the same async semantics
// without leaving a top-level await unsettled at process exit.
// Commander's own validation errors (missing args, unknown commands) call
// process.exit() internally and never reach this catch.
program.parseAsync().catch((err: unknown) => {
  handleCommandError(err, process.argv.includes('--verbose'));
});
