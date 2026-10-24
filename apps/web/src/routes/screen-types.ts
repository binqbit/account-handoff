import type {
  AppCommand,
  AppSnapshot,
  CommandResult,
  Destination,
} from "../ui-contract";
export interface ScreenProps {
  snapshot: AppSnapshot;
  navigate: (destination: Destination, actionId?: string) => void;
  run: (command: AppCommand) => Promise<CommandResult | void>;
  openAction: (id: string) => void;
}
