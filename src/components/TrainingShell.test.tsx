// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { TrainingShell } from "./TrainingShell";
import { trainingNavigation, useTrainingSession } from "../lib/training-session";

vi.mock('./TrainingPage', async () => {
  const { TrainingOptimizer } = await import('./TrainingOptimizer')
  return { TrainingPage: () => <TrainingOptimizer standalone disabled={false} beforeStart={async () => {}} runningChanged={running => useTrainingSession.setState({ running })} /> }
})
vi.mock("./PracticeScreen", () => ({ PracticeScreen: () => <div>Retained practice</div> }));
vi.mock("../audio/training-dataset", () => ({
  createLocalTrainingRepository: () => ({
    read: async () => ({
      fingerprint: "a".repeat(64),
      dataset: { manifest: { groups: [], examples: [{}] } },
    }),
  }),
}));
vi.mock("../audio/training-optimizer-records", () => ({
  createOptimizerRunStore: () => ({ list: async () => [], save: vi.fn() }),
}));
const workers: { terminate: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }[] =
  [];
class WorkerMock {
  terminate = vi.fn();
  postMessage = vi.fn();
  onmessage = null;
  onerror = null;
  constructor() {
    workers.push(this);
  }
}
afterEach(() => {
  cleanup();
  trainingNavigation.guards.clear();
  useTrainingSession.setState({ running: false });
  vi.unstubAllGlobals();
  workers.length = 0;
});
it("keeps the same worker alive across tab visibility and route changes, and awaits navigation guards", async () => {
  vi.stubGlobal("Worker", WorkerMock);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const root = createRootRoute({
    component: () => (
      <TrainingShell>
        <Outlet />
      </TrainingShell>
    ),
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <Link to="/training">Open training</Link>,
  });
  const training = createRoute({
    getParentRoute: () => root,
    path: "/training",
    component: () => (
      <>
        <Link to="/">Practice</Link>
        <div id="training-optimization-panel" />
      </>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([home, training]),
    history: createMemoryHistory({ initialEntries: ["/training"] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "Start parameter search" });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Start parameter search" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start parameter search" }));
  await waitFor(() => expect(workers).toHaveLength(1));
  await waitFor(() => expect(workers[0].postMessage).toHaveBeenCalled());
  const worker = workers[0];
  trainingNavigation.guards.set("test", vi.fn().mockResolvedValue(false));
  await act(async () => {
    void router.navigate({ to: "/" });
  });
  expect(router.state.location.pathname).toBe("/training");
  trainingNavigation.guards.set("test", vi.fn().mockResolvedValue(true));
  await act(async () => {
    void router.navigate({ to: "/" });
  });
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(worker.terminate).not.toHaveBeenCalled();
  expect(useTrainingSession.getState().running).toBe(true);
  await act(async () => {
    void router.navigate({ to: "/training" });
  });
  expect(await screen.findByRole("button", { name: "Cancel optimization" })).toBeTruthy();
  expect(workers).toHaveLength(1);
  expect(worker.terminate).not.toHaveBeenCalled();
});
