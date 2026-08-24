/**
 * Turns a saved Mahjong paipu into a linear, seekable sequence. A position is
 * the number of steps already applied: position 0 is the first hand's deal-in.
 */
export function buildMahjongPaipuTimeline(record) {
  const hands = Array.isArray(record?.hands) ? record.hands : [];
  const steps = [];
  const handStarts = [];

  for (let handIndex = 0; handIndex < hands.length; handIndex += 1) {
    const hand = hands[handIndex];
    if (!hand || !Array.isArray(hand.commands)) {
      throw new Error("Paipu hand has an invalid command log");
    }
    if (handIndex > 0) {
      steps.push({ kind: "next-hand", handIndex });
    }
    handStarts.push(steps.length);
    for (let commandIndex = 0; commandIndex < hand.commands.length; commandIndex += 1) {
      const command = hand.commands[commandIndex];
      if (!command?.action || !Number.isInteger(command.seat)) {
        throw new Error("Paipu command is invalid");
      }
      steps.push({
        kind: "action",
        handIndex,
        commandIndex,
        command,
      });
    }
  }

  if (!hands.length) throw new Error("Paipu has no hands");
  return { hands, steps, handStarts };
}

export function paipuHandIndexAtPosition(timeline, position) {
  const safePosition = clampPaipuPosition(timeline, position);
  let handIndex = 0;
  for (let index = 1; index < timeline.handStarts.length; index += 1) {
    if (timeline.handStarts[index] > safePosition) break;
    handIndex = index;
  }
  return handIndex;
}

export function clampPaipuPosition(timeline, position) {
  return Math.max(0, Math.min(timeline.steps.length, Math.trunc(Number(position) || 0)));
}

export function paipuNextHandPosition(timeline, position) {
  const handIndex = paipuHandIndexAtPosition(timeline, position);
  return timeline.handStarts[handIndex + 1] ?? timeline.steps.length;
}

export function paipuPreviousHandPosition(timeline, position) {
  const handIndex = paipuHandIndexAtPosition(timeline, position);
  if (handIndex === 0) return 0;
  return timeline.handStarts[handIndex - 1];
}

