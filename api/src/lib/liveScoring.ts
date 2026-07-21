export type Multiplier = "single" | "double" | "triple";

export function isMultiplier(value: unknown): value is Multiplier {
  return value === "single" || value === "double" || value === "triple";
}

export function isValidSegment(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && ((value >= 1 && value <= 20) || value === 25);
}

export function isValidThrowInput(multiplier: unknown, segment: unknown): boolean {
  if (!isMultiplier(multiplier)) {
    return false;
  }
  if (!isValidSegment(segment)) {
    return false;
  }
  if (segment === 25 && multiplier === "triple") {
    return false;
  }
  return true;
}

export function throwValue(multiplier: Multiplier, segment: number): number {
  const factor = multiplier === "single" ? 1 : multiplier === "double" ? 2 : 3;
  return factor * segment;
}

export type StoredThrow = {
  id: number;
  turnNumber: number;
  dartNumber: number;
  playerId: number;
  multiplier: Multiplier;
  segment: number;
  value: number;
};

export type StoredLeg = {
  id: number;
  legNumber: number;
  startingPlayerId: number;
  throws: StoredThrow[];
};

export type BustUpdate = { throwId: number; busted: boolean };

export type LegResult = {
  legId: number;
  winnerPlayerId: number | null;
  checkoutValue: number | null;
  bustUpdates: BustUpdate[];
};

export type CurrentTurn = {
  legNumber: number;
  turnNumber: number;
  dartNumber: number;
  playerId: number;
  player1Remaining: number;
  player2Remaining: number;
};

export type MatchOutcome = {
  complete: boolean;
  winnerPlayerId: number | null;
  player1Legs: number;
  player2Legs: number;
  player1Checkout: number | null;
  player2Checkout: number | null;
};

export type ReplayOutcome = {
  legResults: LegResult[];
  currentTurn: CurrentTurn | null;
  needsNextLeg: boolean;
  nextLegStartingPlayerId: number | null;
  trailingEmptyLegId: number | null;
  match: MatchOutcome;
};

function otherPlayer(playerId: number, player1Id: number, player2Id: number): number {
  return playerId === player1Id ? player2Id : player1Id;
}

/**
 * Replays every stored throw of a match from scratch to derive bust flags,
 * leg winners/checkouts, whose turn is next, and whether the match is
 * complete. Called after every insert or delete of a Throw row so derived
 * state never drifts from the raw throw log.
 */
export function replayMatch(player1Id: number, player2Id: number, legs: StoredLeg[]): ReplayOutcome {
  const legResults: LegResult[] = [];
  let player1Legs = 0;
  let player2Legs = 0;
  let player1Checkout: number | null = null;
  let player2Checkout: number | null = null;
  let currentTurn: CurrentTurn | null = null;
  let trailingEmptyLegId: number | null = null;
  let lastLeg: StoredLeg | null = null;

  for (const leg of legs) {
    lastLeg = leg;

    if (leg.throws.length === 0) {
      if (leg.legNumber !== 1) {
        trailingEmptyLegId = leg.id;
      }
      legResults.push({ legId: leg.id, winnerPlayerId: null, checkoutValue: null, bustUpdates: [] });
      currentTurn = {
        legNumber: leg.legNumber,
        turnNumber: 1,
        dartNumber: 1,
        playerId: leg.startingPlayerId,
        player1Remaining: 501,
        player2Remaining: 501,
      };
      continue;
    }

    const turnNumbers = Array.from(new Set(leg.throws.map((th) => th.turnNumber))).sort((a, b) => a - b);
    let player1Remaining = 501;
    let player2Remaining = 501;
    let winnerPlayerId: number | null = null;
    let checkoutValue: number | null = null;
    const bustUpdates: BustUpdate[] = [];
    let lastCompleteTurnPlayerId = leg.startingPlayerId;
    let lastCompleteTurnNumber = 0;
    let openTurn: { turnNumber: number; playerId: number; throws: StoredThrow[] } | null = null;

    for (const turnNumber of turnNumbers) {
      const turnThrows = leg.throws
        .filter((th) => th.turnNumber === turnNumber)
        .sort((a, b) => a.dartNumber - b.dartNumber);
      const turnPlayerId = turnThrows[0].playerId;
      const startRemaining = turnPlayerId === player1Id ? player1Remaining : player2Remaining;

      let running = startRemaining;
      let busted = false;
      let checkedOut = false;
      let dartsResolved = 0;
      for (const th of turnThrows) {
        running -= th.value;
        dartsResolved++;
        if (running < 0 || running === 1) {
          busted = true;
          break;
        }
        if (running === 0) {
          checkedOut = th.multiplier === "double";
          busted = !checkedOut;
          break;
        }
      }

      const turnResolved = busted || checkedOut || dartsResolved === 3;
      if (!turnResolved) {
        openTurn = { turnNumber, playerId: turnPlayerId, throws: turnThrows };
        if (turnPlayerId === player1Id) {
          player1Remaining = running;
        } else {
          player2Remaining = running;
        }
        break;
      }

      for (const th of turnThrows) {
        bustUpdates.push({ throwId: th.id, busted });
      }
      if (!busted && turnPlayerId === player1Id) {
        player1Remaining = running;
      }
      if (!busted && turnPlayerId === player2Id) {
        player2Remaining = running;
      }

      if (checkedOut) {
        winnerPlayerId = turnPlayerId;
        checkoutValue = startRemaining;
      }

      lastCompleteTurnPlayerId = turnPlayerId;
      lastCompleteTurnNumber = turnNumber;

      if (winnerPlayerId !== null) {
        break;
      }
    }

    legResults.push({ legId: leg.id, winnerPlayerId, checkoutValue, bustUpdates });

    if (winnerPlayerId === player1Id) {
      player1Legs++;
      if (player1Checkout === null || checkoutValue! > player1Checkout) {
        player1Checkout = checkoutValue;
      }
    }
    if (winnerPlayerId === player2Id) {
      player2Legs++;
      if (player2Checkout === null || checkoutValue! > player2Checkout) {
        player2Checkout = checkoutValue;
      }
    }

    if (winnerPlayerId !== null) {
      currentTurn = null;
      continue;
    }

    if (openTurn) {
      currentTurn = {
        legNumber: leg.legNumber,
        turnNumber: openTurn.turnNumber,
        dartNumber: openTurn.throws.length + 1,
        playerId: openTurn.playerId,
        player1Remaining,
        player2Remaining,
      };
    } else {
      currentTurn = {
        legNumber: leg.legNumber,
        turnNumber: lastCompleteTurnNumber + 1,
        dartNumber: 1,
        playerId: otherPlayer(lastCompleteTurnPlayerId, player1Id, player2Id),
        player1Remaining,
        player2Remaining,
      };
    }
  }

  const matchComplete = player1Legs >= 3 || player2Legs >= 3;
  const lastLegResult = legResults.length > 0 ? legResults[legResults.length - 1] : null;
  const needsNextLeg = !matchComplete && lastLegResult !== null && lastLegResult.winnerPlayerId !== null;
  const nextLegStartingPlayerId =
    needsNextLeg && lastLeg ? otherPlayer(lastLeg.startingPlayerId, player1Id, player2Id) : null;

  return {
    legResults,
    currentTurn: matchComplete ? null : currentTurn,
    needsNextLeg,
    nextLegStartingPlayerId,
    trailingEmptyLegId: matchComplete ? null : trailingEmptyLegId,
    match: {
      complete: matchComplete,
      winnerPlayerId: matchComplete ? (player1Legs >= 3 ? player1Id : player2Id) : null,
      player1Legs,
      player2Legs,
      player1Checkout,
      player2Checkout,
    },
  };
}
