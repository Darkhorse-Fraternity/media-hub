import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/scripts")({
  beforeLoad: () => {
    redirect({ to: "/", replace: true, throw: true });
  },
});
