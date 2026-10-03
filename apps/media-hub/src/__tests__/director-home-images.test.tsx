// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMediaVideoScriptSchema } from "@acme/validators";

import { useVideoScriptStudio } from "../hooks/use-video-script-studio";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  create: vi.fn(),
  draft: vi.fn(),
  images: [] as { id: string }[],
  imageError: null as Error | null,
  imagePending: false,
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
  useQuery: (options: { queryKey: string[]; enabled?: boolean }) => ({
    data:
      options.queryKey[0] === "images" && options.enabled
        ? mocks.images
        : undefined,
    isError: options.queryKey[0] === "images" && !!mocks.imageError,
    error: mocks.imageError,
    isPending: options.queryKey[0] === "images" && mocks.imagePending,
  }),
  useMutation: (options: { name: string }) => ({
    isPending: false,
    mutateAsync:
      options.name === "create"
        ? mocks.create
        : options.name === "draft"
          ? mocks.draft
          : vi.fn(),
  }),
}));
vi.mock("../lib/trpc", () => {
  const procedure = (name: string) => ({
    queryOptions: () => ({ queryKey: [name] }),
    queryKey: () => [name],
    mutationOptions: () => ({ name }),
  });
  return {
    useTRPC: () => ({
      mediaHub: {
        script: Object.fromEntries(
          [
            "get",
            "list",
            "create",
            "draft",
            "update",
            "delete",
            "generate",
            "assemble",
            "bridgeLastFrame",
            "createFrameCandidates",
            "selectFrameCandidate",
            "selectTake",
            "generateCaptions",
            "createAnimatic",
          ].map((name) => [name, procedure(name)]),
        ),
        generation: { providerHealth: procedure("health") },
        image: {
          list: procedure("library"),
          prepareVideoInputs: procedure("images"),
        },
      },
    }),
  };
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.images = [{ id: "frame-a" }, { id: "frame-b" }];
  mocks.imageError = null;
  mocks.imagePending = false;
  mocks.create.mockResolvedValue({ id: "new-script" });
  mocks.draft.mockResolvedValue({
    title: "示例",
    copy: "文案",
    continuityBible: {},
    shots: [{ id: "a" }, { id: "b" }],
  });
});

async function startDraft() {
  const hook = renderHook(() =>
    useVideoScriptStudio(undefined, ["frame-a", "frame-b"]),
  );
  act(() => hook.result.current.setNewBrief("两个镜头的故事"));
  await act(async () => {
    await hook.result.current.createFromBrief();
  });
  return hook;
}

describe("image library handoff to the director", () => {
  it("assigns validated images to drafted shots in order and opens the same workspace", async () => {
    await startDraft();
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        shots: [
          expect.objectContaining({ id: "a", firstFrameAssetId: "frame-a" }),
          expect.objectContaining({ id: "b", firstFrameAssetId: "frame-b" }),
        ],
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/scripts/$scriptId",
      params: { scriptId: "new-script" },
    });
  });

  it("retains selected frames when starting without an AI draft", async () => {
    const hook = renderHook(() =>
      useVideoScriptStudio(undefined, ["frame-a", "frame-b"]),
    );
    act(() => {
      hook.result.current.setNewTitle("素材故事");
      hook.result.current.setNewBrief("创作简报");
      hook.result.current.setWidth(768);
      hook.result.current.setHeight(1344);
      hook.result.current.setDefaultProfile("portrait-profile");
    });
    await act(async () => {
      await hook.result.current.createBlank();
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 768,
        height: 1344,
        defaultProfile: "portrait-profile",
        shots: [
          expect.objectContaining({ firstFrameAssetId: "frame-a" }),
          expect.objectContaining({ firstFrameAssetId: "frame-b" }),
        ],
      }),
    );
    expect(
      createMediaVideoScriptSchema.safeParse(mocks.create.mock.calls[0]?.[0])
        .success,
    ).toBe(true);
  });

  it("reports inaccessible images without creating a script or requesting an AI draft", async () => {
    mocks.imageError = new Error("没有权限访问这张图片");
    const hook = await startDraft();
    expect(hook.result.current.message).toBe("没有权限访问这张图片");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.draft).not.toHaveBeenCalled();
  });

  it("keeps creation busy until imported images have been validated", () => {
    mocks.imagePending = true;
    const hook = renderHook(() => useVideoScriptStudio(undefined, ["frame-a"]));
    expect(hook.result.current.generating).toBe(true);
  });
});
