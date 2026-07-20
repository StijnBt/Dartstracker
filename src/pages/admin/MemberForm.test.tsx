import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import MemberForm from "./MemberForm";

describe("MemberForm", () => {
  it("shows an editable username field and a required password field in create mode", () => {
    render(<MemberForm mode="create" onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeRequired();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  });

  it("shows a fixed username and an optional password field in edit mode", () => {
    render(
      <MemberForm
        mode="edit"
        initialValues={{ username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true }}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    expect(screen.getByText("bsmith")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).not.toBeRequired();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
  });

  it("disables role and status when disableRoleAndStatus is set", () => {
    render(
      <MemberForm
        mode="edit"
        initialValues={{ username: "admin", displayName: "Administrator", role: "admin", isActive: true }}
        disableRoleAndStatus
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Role")).toBeDisabled();
    expect(screen.getByLabelText("Status")).toBeDisabled();
  });

  it("rejects a create submission with a password shorter than 8 characters", async () => {
    const onSubmit = vi.fn();
    render(<MemberForm mode="create" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Username"), "bsmith");
    await userEvent.type(screen.getByLabelText("Display name"), "Bob Smith");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("at least 8 characters");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the entered values in create mode", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MemberForm mode="create" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Username"), "bsmith");
    await userEvent.type(screen.getByLabelText("Display name"), "Bob Smith");
    await userEvent.type(screen.getByLabelText("Password"), "secretpw1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        username: "bsmith",
        displayName: "Bob Smith",
        role: "player",
        isActive: true,
        password: "secretpw1",
      });
    });
  });

  it("allows submitting in edit mode with a blank password", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <MemberForm
        mode="edit"
        initialValues={{ username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true }}
        onSubmit={onSubmit}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        username: "bsmith",
        displayName: "Bob Smith",
        role: "player",
        isActive: true,
        password: "",
      });
    });
  });

  it("shows an error message when onSubmit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Username already exists"));
    render(<MemberForm mode="create" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Display name"), "Dup");
    await userEvent.type(screen.getByLabelText("Password"), "secretpw1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Username already exists");
    });
  });
});
