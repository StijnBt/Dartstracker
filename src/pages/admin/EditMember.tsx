import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import MemberForm, { type MemberFormValues } from "./MemberForm";
import { listMembers, updateMember, type Member, type UpdateMemberInput } from "../../lib/api-client";
import { useAuth } from "../../lib/AuthContext";

export default function EditMember() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMembers()
      .then((members) => {
        const found = members.find((m) => String(m.id) === id);
        if (!found) {
          setError("Member not found");
        } else {
          setMember(found);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load member"))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(values: MemberFormValues) {
    const update: UpdateMemberInput = {
      displayName: values.displayName,
      role: values.role,
      isActive: values.isActive,
    };
    if (values.password) {
      update.password = values.password;
    }
    await updateMember(Number(id), update);
    navigate("/admin/members");
  }

  if (loading) {
    return <p className="p-4">Loading…</p>;
  }

  if (error || !member) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        {error ?? "Member not found"}
      </p>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">Edit Member</h1>
      <MemberForm
        mode="edit"
        initialValues={member}
        disableRoleAndStatus={currentUser?.id === member.id}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
