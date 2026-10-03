import { execFileSync } from "node:child_process";
import type { Server } from "node:http";

export function configureTestDockerHost(): void {
  if (process.env.DOCKER_HOST || process.platform !== "darwin") return;
  const host = execFileSync(
    "docker",
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { encoding: "utf8" },
  ).trim();
  if (host) process.env.DOCKER_HOST = host;
}

export async function closeTestServer(server?: Server): Promise<void> {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
