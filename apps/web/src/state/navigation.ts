import type { Destination } from "../ui-contract";

export const navigation: { id: Destination; label: string; icon: string }[] = [
  { id: "overview", label: "Огляд", icon: "overview" },
  { id: "milestones", label: "Грант і етапи", icon: "milestones" },
  { id: "team", label: "Команда", icon: "team" },
  { id: "history", label: "Історія", icon: "history" },
];
export const titles: Record<Destination, string> = {
  overview: "Огляд",
  milestones: "Грант і етапи",
  team: "Команда",
  history: "Історія",
  workspaces: "Робочі простори",
  setup: "Налаштування",
  handoff: "Передача керування",
  review: "Перегляд операції",
  network: "Мережа та готовність",
  data: "Дані простору",
  attention: "Потребує уваги",
};
