import { createTRPCRouter } from "../../trpc";
import { adminUserRouter } from "./user";

export const adminRouter = createTRPCRouter({
  user: adminUserRouter,
});
