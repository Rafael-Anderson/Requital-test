import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  onUnauthorized: vi.fn(() => () => {}),
}));
vi.mock("./api", () => api);
const reset = vi.hoisted(() => vi.fn());
vi.mock("./useChannelAvailability", () => ({ resetChannelAvailabilityCache: reset }));

import { AuthProvider, useAuth } from "./auth-context";

function Probe() {
  const { user, login, logout } = useAuth();
  return (
    <div>
      <span>{user ? `user:${user.email}` : "anon"}</span>
      <button onClick={() => void login("a@b.c", "pw")}>login</button>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
}

afterEach(cleanup);

// The marketplace availability answer is cached for a minute at module level.
// It must not outlive the identity it was fetched for.
describe("AuthProvider drops the shared marketplace-availability cache on identity change", () => {
  it("on login and on logout", async () => {
    const user = userEvent.setup();
    api.me.mockRejectedValue(new Error("401"));
    api.login.mockResolvedValue({ user: { id: 1, email: "a@b.c", role: "admin" } });
    api.logout.mockResolvedValue(undefined);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText("anon");
    reset.mockClear();
    await user.click(screen.getByText("login"));
    await screen.findByText("user:a@b.c");
    expect(reset).toHaveBeenCalled();
    reset.mockClear();
    await user.click(screen.getByText("logout"));
    await waitFor(() => expect(screen.getByText("anon")).toBeInTheDocument());
    expect(reset).toHaveBeenCalled();
  });
});
