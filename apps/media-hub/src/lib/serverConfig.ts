import { createServerFn } from "@tanstack/react-start";

export const getPublicConfig = createServerFn().handler(() => {
  return {};
});
