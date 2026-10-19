import { create } from "zustand";
import { baselineParameters, type OptimizerParameters } from "../audio/training-optimizer";

/** Route-independent ownership: navigating never unmounts an optimizer run. */
export const useTrainingSession = create<{
  samples: { checksum: string; name: string }[];
  importReport: { duplicates: string[]; errors: { name: string; message: string }[] };
  annotating: boolean;
  importing: boolean;
  current: OptimizerParameters;
  running: boolean;
  progress: string;
  adopt: OptimizerParameters | null;
}>(() => ({ samples: [], importReport: { duplicates: [], errors: [] }, annotating: false, importing: false, current: baselineParameters("current"), running: false, progress: "", adopt: null }));
export const trainingNavigation: {
  guards: Map<string, () => Promise<boolean>>;
  importAudio?: () => void;
  openSample?: (checksum: string) => Promise<void>;
  go?: (path: "/" | "/training") => void;
} = { guards: new Map() };
export async function allowWorkspaceNavigation() {
  // Guards can unregister themselves while awaiting an editor decision.
  const guards = [...trainingNavigation.guards.values()];
  for (const guard of guards) if (!(await guard())) return false;
  return true;
}
