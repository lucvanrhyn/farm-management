// @vitest-environment jsdom
/**
 * __tests__/admin/tasks-ssr-pagination.test.tsx
 *
 * Phase I.1: admin/tasks SSR must stop rendering the entire task list. Prove
 * the page calls `prisma.task.findMany` with a bounded `take:` and passes
 * `initialTasks`, `nextCursor`, `hasMore` to TaskBoard.
 *
 * TDD — RED first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import React from "react";

const taskFindManyMock = vi.fn();
const campFindManyMock = vi.fn();
const getPrismaForFarmMock = vi.fn();
const getFarmCredsMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/farm-prisma", () => ({ getPrismaForFarm: getPrismaForFarmMock }));
vi.mock("@/lib/meta-db", () => ({ getFarmCreds: getFarmCredsMock }));

// Capture props passed to TaskBoard without needing to mount its UI.
const taskBoardProps: Record<string, unknown>[] = [];
vi.mock("@/components/admin/TaskBoard", () => ({
  TaskBoard: (props: Record<string, unknown>) => {
    taskBoardProps.push(props);
    return <div data-testid="task-board-stub" />;
  },
}));
vi.mock("@/components/admin/UpgradePrompt", () => ({
  default: () => null,
}));

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  campId: string | null;
  animalId: string | null;
  assignedTo: string;
  createdBy: string;
  dueDate: string;
  status: string;
  priority: string;
  completedAt: string | null;
  createdAt: Date;
}

function fakeTasks(n: number): TaskRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t-${String(i + 1).padStart(4, "0")}`,
    title: `Task ${i + 1}`,
    description: null,
    campId: null,
    animalId: null,
    assignedTo: "worker@farm.com",
    createdBy: "admin@farm.com",
    dueDate: `2026-04-${String(((i % 28) + 1)).padStart(2, "0")}`,
    status: "pending",
    priority: "normal",
    completedAt: null,
    createdAt: new Date(`2026-04-01T00:${String(i % 60).padStart(2, "0")}:00Z`),
  }));
}

beforeEach(() => {
  taskFindManyMock.mockReset();
  campFindManyMock.mockReset();
  getPrismaForFarmMock.mockReset();
  getFarmCredsMock.mockReset();
  getSessionMock.mockReset();
  taskBoardProps.length = 0;

  getSessionMock.mockResolvedValue({ user: { email: "admin@farm.com" } });
  getFarmCredsMock.mockResolvedValue({ tier: "advanced" });
  campFindManyMock.mockResolvedValue([
    { campId: "camp-1", campName: "Camp 1" },
  ]);
  getPrismaForFarmMock.mockResolvedValue({
    task: { findMany: taskFindManyMock },
    camp: { findMany: campFindManyMock },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<TasksPage /> — SSR pagination", () => {
  it("asks Prisma for a bounded number of tasks via take:", async () => {
    taskFindManyMock.mockResolvedValue(fakeTasks(50));
    const { default: TasksPage } = await import(
      "@/app/[farmSlug]/admin/tasks/page"
    );
    await TasksPage({
      params: Promise.resolve({ farmSlug: "test-farm" }),
      searchParams: Promise.resolve({}),
    });

    expect(taskFindManyMock).toHaveBeenCalledTimes(1);
    const call = taskFindManyMock.mock.calls[0][0];
    expect(call.take).toBeDefined();
    expect(typeof call.take).toBe("number");
    // Take should be limit+1 (fetch one past to detect hasMore), and limit
    // should be in a sane SSR range (≤ 200).
    expect(call.take).toBeGreaterThanOrEqual(2);
    expect(call.take).toBeLessThanOrEqual(201);
  });

  it("uses a stable composite orderBy [dueDate, createdAt, id]", async () => {
    taskFindManyMock.mockResolvedValue(fakeTasks(10));
    const { default: TasksPage } = await import(
      "@/app/[farmSlug]/admin/tasks/page"
    );
    await TasksPage({
      params: Promise.resolve({ farmSlug: "test-farm" }),
      searchParams: Promise.resolve({}),
    });

    const call = taskFindManyMock.mock.calls[0][0];
    expect(call.orderBy).toEqual([
      { dueDate: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("passes hasMore + nextCursor to TaskBoard when a full page is returned", async () => {
    // Page size default inferred as 50; to test hasMore we return 51 rows.
    taskFindManyMock.mockResolvedValue(fakeTasks(51));
    const { default: TasksPage } = await import(
      "@/app/[farmSlug]/admin/tasks/page"
    );
    const element = await TasksPage({
      params: Promise.resolve({ farmSlug: "test-farm" }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(taskBoardProps).toHaveLength(1);
    const props = taskBoardProps[0];
    expect(Array.isArray(props.initialTasks)).toBe(true);
    // initialTasks must not include the "+1 lookahead" row.
    expect((props.initialTasks as unknown[]).length).toBe(50);
    expect(props.hasMore).toBe(true);
    expect(typeof props.nextCursor).toBe("string");
  });

  it("passes hasMore:false and nextCursor:null when the DB is shorter than the page", async () => {
    taskFindManyMock.mockResolvedValue(fakeTasks(12));
    const { default: TasksPage } = await import(
      "@/app/[farmSlug]/admin/tasks/page"
    );
    const element = await TasksPage({
      params: Promise.resolve({ farmSlug: "test-farm" }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    const props = taskBoardProps[0];
    expect((props.initialTasks as unknown[]).length).toBe(12);
    expect(props.hasMore).toBe(false);
    expect(props.nextCursor).toBeNull();
  });
});
