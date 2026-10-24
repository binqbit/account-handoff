import { useCallback, useEffect, useState } from "react";
import type { Destination } from "../ui-contract";
const destinations = new Set<Destination>([
  "overview",
  "milestones",
  "team",
  "history",
  "workspaces",
  "setup",
  "handoff",
  "review",
  "network",
  "data",
  "attention",
]);
function readRoute(): { destination: Destination; actionId: string | null } {
  const hash = window.location.hash.slice(1);
  const [path, query] = hash.split("?");
  const candidate = (path || "overview") as Destination;
  return {
    destination: destinations.has(candidate) ? candidate : "overview",
    actionId: new URLSearchParams(query).get("action"),
  };
}
export function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const change = () => setRoute(readRoute());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const navigate = useCallback(
    (destination: Destination, actionId?: string) => {
      const hash = `${destination}${actionId ? `?action=${encodeURIComponent(actionId)}` : ""}`;
      if (window.location.hash !== `#${hash}`) window.location.hash = hash;
      else setRoute(readRoute());
    },
    [],
  );
  useEffect(() => {
    document.getElementById("page-heading")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [route.destination]);
  return { ...route, navigate };
}
