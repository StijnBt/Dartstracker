import { useNavigate } from "react-router-dom";
import MemberForm, { type MemberFormValues } from "./MemberForm";
import { createMember } from "../../lib/api-client";

export default function NewMember() {
  const navigate = useNavigate();

  async function handleSubmit(values: MemberFormValues) {
    await createMember({
      username: values.username,
      displayName: values.displayName,
      role: values.role,
      password: values.password,
    });
    navigate("/admin/members");
  }

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">Add Member</h1>
      <MemberForm mode="create" onSubmit={handleSubmit} />
    </div>
  );
}
