export type SourceStatus = {
  manualStatus: "none" | "imported";
  mailStatus: "unchecked" | "found" | "missing" | "error";
  portalStatus:
    | "not_needed"
    | "required"
    | "running"
    | "found"
    | "not_found"
    | "failed"
    | "disabled";
};

export type FinalInvoiceStatus = {
  finalStatus: "unchecked" | "found" | "missing" | "action_required";
  sourceUsed: "none" | "manual" | "mail" | "portal";
};

export function resolveVendorMonthStatus(status: SourceStatus): FinalInvoiceStatus {
  if (status.manualStatus === "imported") {
    return { finalStatus: "found", sourceUsed: "manual" };
  }

  if (status.mailStatus === "found") {
    return { finalStatus: "found", sourceUsed: "mail" };
  }

  if (status.portalStatus === "found") {
    return { finalStatus: "found", sourceUsed: "portal" };
  }

  if (status.portalStatus === "failed" || status.mailStatus === "error") {
    return { finalStatus: "action_required", sourceUsed: "none" };
  }

  if (status.portalStatus === "running" || status.mailStatus === "unchecked") {
    return { finalStatus: "unchecked", sourceUsed: "none" };
  }

  return { finalStatus: "missing", sourceUsed: "none" };
}

export function shouldRunPortalFallback(status: SourceStatus) {
  return (
    status.manualStatus !== "imported" &&
    status.mailStatus !== "found" &&
    (status.portalStatus === "required" ||
      status.portalStatus === "failed" ||
      status.portalStatus === "not_found")
  );
}
