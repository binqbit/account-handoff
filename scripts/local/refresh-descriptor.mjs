import { readRun, emitDescriptor, output, main } from "./shared.mjs";
await main(async (args) => {
  const run = readRun(args.run ?? "development");
  emitDescriptor(run, { activate: true });
  output({
    status: "DESCRIPTOR_REFRESHED",
    runId: run.runId,
    generation: run.generation,
  });
});
