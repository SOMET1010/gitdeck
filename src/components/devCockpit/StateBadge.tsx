import type { CheckState, ReadinessVerdict } from "../../types/devCockpit";
import { toneForState } from "../../utils/devCockpit/display";

interface StateBadgeProps {
  state: CheckState | ReadinessVerdict;
  label: string;
}

/** Reuses the CI conclusion pill styling so cockpit states match the CI view. */
export function StateBadge({ state, label }: StateBadgeProps) {
  return <span className={`ci-conclusion ${toneForState(state)}`} data-state={state}>{label}</span>;
}
