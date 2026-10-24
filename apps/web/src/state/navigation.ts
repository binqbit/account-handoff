import type { Destination } from "../ui-contract";

export const navigation: {
  id: Destination;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "overview",
    description: "Your workspace at a glance",
  },
  {
    id: "milestones",
    label: "Grant and milestones",
    icon: "milestones",
    description: "Deliver work and review progress",
  },
  {
    id: "team",
    label: "Team",
    icon: "team",
    description: "People, roles and balances",
  },
  {
    id: "handoff",
    label: "Control handoff",
    icon: "handoff",
    description: "Move authority to the new team",
  },
  {
    id: "history",
    label: "History",
    icon: "history",
    description: "Activity and verified outcomes",
  },
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
