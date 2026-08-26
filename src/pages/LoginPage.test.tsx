// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  login: vi.fn(),
}));

vi.mock("../store", () => ({
  useApp: () => ({
    login: h.login,
    t: (k: string) => k,
  }),
}));

import { LoginPage } from "./LoginPage";

afterEach(cleanup);

describe("LoginPage", () => {
  it("renders the password field and submit button", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText("login_password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "login_button" })).toBeTruthy();
  });

  it("does not call login when the password is empty", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "login_button" }));
    expect(h.login).not.toHaveBeenCalled();
  });

  it("calls login with the typed password", async () => {
    h.login.mockResolvedValue(undefined);
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("login_password"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByRole("button", { name: "login_button" }));
    await waitFor(() => expect(h.login).toHaveBeenCalledWith("s3cret"));
  });

  it("shows an error when login fails", async () => {
    h.login.mockImplementation(() => Promise.reject(new Error("bad")));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("login_password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "login_button" }));
    expect(await screen.findByText("login_invalid")).toBeTruthy();
  });

  it("clears a previous error on a later successful login", async () => {
    h.login.mockRejectedValueOnce(new Error("bad")).mockResolvedValueOnce(undefined);
    render(<LoginPage />);
    const input = screen.getByLabelText("login_password");
    const btn = screen.getByRole("button", { name: "login_button" });
    fireEvent.change(input, { target: { value: "a" } });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(await screen.findByText("login_invalid")).toBeTruthy();
    fireEvent.change(input, { target: { value: "b" } });
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(screen.queryByText("login_invalid")).toBeNull());
  });
});
