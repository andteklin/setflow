import type {
  Arrangement,
  ArrangementItem,
  ParsedSong,
  SectionOccurrence,
} from "../types.js";
import { SOURCE_ORDER_ARRANGEMENT_NAME } from "../types.js";

/**
 * Builds the arrangement that mirrors the order sections appeared in the
 * imported source, per spec section 10. Created automatically on import so
 * a chart is immediately usable before the user builds a custom Song Map.
 */
export function createSourceOrderArrangement(
  song: ParsedSong,
  songId: string,
  arrangementId = "source-order",
): Arrangement {
  const items: ArrangementItem[] = [...song.sections]
    .sort((a, b) => a.sourceOrder - b.sourceOrder)
    .map((section) => ({ sectionId: section.id, repetitions: 1 }));

  return {
    id: arrangementId,
    songId,
    name: SOURCE_ORDER_ARRANGEMENT_NAME,
    items,
  };
}

/**
 * Expands an arrangement's section references (with repetition counts)
 * into a flat, ordered performance sequence. A section referenced with
 * `repetitions: 4` produces four SectionOccurrences pointing at the same
 * sectionId rather than four duplicated copies of its content -- per spec
 * section 19, definition and occurrence are different objects.
 */
export function generatePerformanceSequence(
  arrangement: Arrangement,
): SectionOccurrence[] {
  const sequence: SectionOccurrence[] = [];
  let occurrenceIndex = 0;

  for (const item of arrangement.items) {
    const repetitionCount = Math.max(1, item.repetitions);
    for (let repetitionIndex = 0; repetitionIndex < repetitionCount; repetitionIndex++) {
      sequence.push({
        sectionId: item.sectionId,
        occurrenceIndex: occurrenceIndex++,
        repetitionIndex,
        repetitionCount,
      });
    }
  }

  return sequence;
}
