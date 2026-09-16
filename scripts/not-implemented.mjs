// Placeholder target for npm scripts whose implementation has not been built yet.
// Prints the task name and exits 0 so CI and local runs stay green during scaffolding.
const task = process.argv[2] ?? "task";
console.log(`${task}: not implemented yet`);
process.exit(0);
