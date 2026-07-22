import type { HighestCheckoutAward as HighestCheckoutAwardType } from "../../lib/awards";

type HighestCheckoutAwardProps = {
  award: HighestCheckoutAwardType;
};

export default function HighestCheckoutAward({ award }: HighestCheckoutAwardProps) {
  return (
    <p className="mb-6 text-sm">
      {award === null ? (
        "No checkouts recorded yet"
      ) : (
        <>
          Highest Checkout: <strong>{award.value}</strong> —{" "}
          {award.players.map((p) => p.displayName).join(", ")}
        </>
      )}
    </p>
  );
}
