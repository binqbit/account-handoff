import type {
  AppCommand,
  AppSnapshot,
  CommandResult,
  Destination,
} from "../ui-contract";
/** Commands may fail or be declined while another command is running. */
export type CommandOutcome =
  { succeeded: true; result: CommandResult | void } | { succeeded: false };

export interface ScreenProps {
  snapshot: AppSnapshot;
  navigate: (destination: Destination, actionId?: string) => void;
  run: (command: AppCommand) => Promise<CommandOutcome>;
  openAction: (id: string) => void;
}
