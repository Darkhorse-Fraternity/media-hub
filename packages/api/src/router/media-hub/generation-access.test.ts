import { describe, expect, it } from "vitest";

import {
  canManageMediaGenerationJob,
  isActiveMediaGenerationStatus,
  isCancelableMediaGenerationStatus,
  isDeletableMediaGenerationStatus,
  isEditableMediaGenerationStatus,
  isProtectedMediaPublishStatus,
  isProtectedMediaTaskStatus,
  isRetryableMediaGenerationStatus,
} from "./generation-access";

describe("media generation access", () => {
  it("allows members to manage their own jobs", () => {
    expect(
      canManageMediaGenerationJob({
        actorUserId: "member-1",
        actorRole: "member",
        ownerUserId: "member-1",
      }),
    ).toBe(true);
  });

  it("prevents members from managing another user's jobs", () => {
    expect(
      canManageMediaGenerationJob({
        actorUserId: "member-1",
        actorRole: "member",
        ownerUserId: "member-2",
      }),
    ).toBe(false);
  });

  it("allows admins to manage every job", () => {
    expect(
      canManageMediaGenerationJob({
        actorUserId: "admin-1",
        actorRole: "admin",
        ownerUserId: "member-2",
      }),
    ).toBe(true);
  });

  it("only edits waiting jobs but can cancel running jobs", () => {
    expect(isEditableMediaGenerationStatus("scheduled")).toBe(true);
    expect(isEditableMediaGenerationStatus("queued")).toBe(true);
    expect(isEditableMediaGenerationStatus("running")).toBe(false);
    expect(isCancelableMediaGenerationStatus("running")).toBe(true);
    expect(isCancelableMediaGenerationStatus("succeeded")).toBe(false);
  });

  it("treats scheduled, queued, GPU-waiting, and running jobs as active queue entries", () => {
    expect(isActiveMediaGenerationStatus("scheduled")).toBe(true);
    expect(isActiveMediaGenerationStatus("queued")).toBe(true);
    expect(isActiveMediaGenerationStatus("waiting_for_gpu")).toBe(true);
    expect(isActiveMediaGenerationStatus("running")).toBe(true);
    expect(isActiveMediaGenerationStatus("succeeded")).toBe(false);
    expect(isActiveMediaGenerationStatus("failed")).toBe(false);
    expect(isActiveMediaGenerationStatus("canceled")).toBe(false);
  });

  it("only deletes terminal, inactive jobs", () => {
    expect(isDeletableMediaGenerationStatus("succeeded")).toBe(true);
    expect(isDeletableMediaGenerationStatus("failed")).toBe(true);
    expect(isDeletableMediaGenerationStatus("canceled")).toBe(true);
    expect(isDeletableMediaGenerationStatus("running")).toBe(false);
    expect(isDeletableMediaGenerationStatus("queued")).toBe(false);
  });

  it("only retries failed jobs", () => {
    expect(isRetryableMediaGenerationStatus("failed")).toBe(true);
    expect(isRetryableMediaGenerationStatus("queued")).toBe(false);
    expect(isRetryableMediaGenerationStatus("running")).toBe(false);
    expect(isRetryableMediaGenerationStatus("succeeded")).toBe(false);
    expect(isRetryableMediaGenerationStatus("canceled")).toBe(false);
  });

  it("only protects an actively publishing platform target", () => {
    expect(isProtectedMediaPublishStatus("pending")).toBe(false);
    expect(isProtectedMediaPublishStatus("failed")).toBe(false);
    expect(isProtectedMediaPublishStatus("publishing")).toBe(true);
    expect(isProtectedMediaPublishStatus("published")).toBe(false);
  });

  it("allows completed platform posts to outlive their local media task", () => {
    expect(isProtectedMediaTaskStatus("draft")).toBe(false);
    expect(isProtectedMediaTaskStatus("failed")).toBe(false);
    expect(isProtectedMediaTaskStatus("approved")).toBe(true);
    expect(isProtectedMediaTaskStatus("publishing")).toBe(true);
    expect(isProtectedMediaTaskStatus("published")).toBe(false);
    expect(isProtectedMediaTaskStatus("partial_published")).toBe(false);
  });
});
