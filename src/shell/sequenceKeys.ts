import { KIND_VIDEO } from "../core/types";

export function sequenceStepForKey(kindId: string, key: string): 1 | -1 | null {
  if (kindId === KIND_VIDEO) {
    if (key === "ArrowUp") return -1;
    if (key === "ArrowDown") return 1;
    return null;
  }
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowRight") return 1;
  return null;
}
