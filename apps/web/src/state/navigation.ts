import type { Destination } from "../ui-contract";

export const navigation: { id: Destination; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "milestones", label: "Grant and milestones", icon: "milestones" },
  { id: "team", label: "Team", icon: "team" },
  { id: "history", label: "History", icon: "history" },
];
export const titles: Record<Destination, string> = {
  overview: "Overview",
  milestones: "Grant and milestones",
  team: "Team",
  history: "History",
  workspaces: "Workspaces",
  setup: "Setup",
  handoff: "Control handoff",
  review: "Operation review",
  network: "Network and readiness",
  data: "Workspace data",
  attention: "Needs attention",
};
