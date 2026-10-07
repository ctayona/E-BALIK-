import HandoverPinCard from "../dashboard/HandoverPinCard";
import AssignedItemsCard from "./AssignedItemsCard";
import { tr } from "../../utils/preferences";

/**
 * The release desk inside the admin console, for administrators and super administrators. It is the same screen a guard gets
 * (type or scan a Handover PIN, check the person, release the item), plus the list of items handed to guards.
 */
export default function ReleaseDesk() {
  return (
    <div className="mx-auto w-full max-w-[860px] space-y-5 p-4 sm:p-6">
      <p className="max-w-[70ch] text-[14px] text-ink-muted">{tr("Release an approved item to its owner. Guards and administrators use the same screen, so a release is recorded the same way whoever does it.")}</p>
      <HandoverPinCard />
      <AssignedItemsCard showGuard />
    </div>
  );
}
