import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { listMembers, createSeason, type Member } from "../../lib/api-client";
import { computeRoundCount, type RoundType } from "../../lib/roundRobin";

export default function NewSeason() {
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [roundType, setRoundType] = useState<RoundType>("single");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [roundDates, setRoundDates] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listMembers().then((all) => setMembers(all.filter((m) => m.isActive)));
  }, []);

  const roundCount = selectedIds.length >= 2 ? computeRoundCount(selectedIds.length, roundType) : 0;

  useEffect(() => {
    setRoundDates(Array(roundCount).fill(""));
  }, [roundCount]);

  function toggleParticipant(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function updateRoundDate(index: number, value: string) {
    setRoundDates((prev) => prev.map((d, i) => (i === index ? value : d)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (selectedIds.length < 2) {
      setError("Select at least 2 participants");
      return;
    }
    if (roundDates.some((d) => !d)) {
      setError("Every round needs a date");
      return;
    }

    setSubmitting(true);
    try {
      await createSeason({ name: name.trim(), roundType, participantIds: selectedIds, roundDates });
      navigate("/season");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create season");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">New Season</h1>
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          />
        </div>
        <div>
          <label htmlFor="roundType" className="block text-sm font-medium">
            Round type
          </label>
          <select
            id="roundType"
            value={roundType}
            onChange={(e) => setRoundType(e.target.value as RoundType)}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          >
            <option value="single">Single (everyone plays once)</option>
            <option value="double">Double (everyone plays twice)</option>
          </select>
        </div>
        <fieldset>
          <legend className="block text-sm font-medium">Participants</legend>
          <div className="mt-1 space-y-1">
            {members.map((member) => (
              <label key={member.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(member.id)}
                  onChange={() => toggleParticipant(member.id)}
                />
                {member.displayName}
              </label>
            ))}
          </div>
        </fieldset>
        {roundCount > 0 && (
          <fieldset>
            <legend className="block text-sm font-medium">Round dates</legend>
            <div className="mt-1 space-y-2">
              {roundDates.map((date, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-20 text-sm text-gray-500">Round {index + 1}</span>
                  <input
                    id={`round-date-${index}`}
                    type="date"
                    aria-label={`Round ${index + 1} date`}
                    required
                    value={date}
                    onChange={(e) => updateRoundDate(index, e.target.value)}
                    className="rounded border border-gray-300 p-2"
                  />
                </div>
              ))}
            </div>
          </fieldset>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="bg-primary text-primary-content font-heading w-full rounded p-2 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create Season"}
        </button>
      </form>
    </div>
  );
}
