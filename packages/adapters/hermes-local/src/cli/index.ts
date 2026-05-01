import type { CLIAdapterModule } from "@paperclipai/adapter-utils";

// H1 stub. H3 wires this to the same parser used by the UI.
export const formatStdoutEvent: CLIAdapterModule["formatStdoutEvent"] = (
  line,
  _debug,
) => {
  if (line.trim().length === 0) return;
  process.stdout.write(line.endsWith("\n") ? line : `${line}\n`);
};

const cliModule: CLIAdapterModule = {
  type: "hermes_local",
  formatStdoutEvent,
};

export default cliModule;
