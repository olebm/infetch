// Recipe-Schritt-Typen: deterministische Browser-Aktionen, die ein Recipe wiederholbar machen.

export type RecipeStep =
  | { type: "goto"; url: string }
  | {
      type: "fill";
      selector: string;
      valueFrom: "credential.username" | "credential.password" | "totp";
    }
  | { type: "click"; selector: string }
  | { type: "waitForUrl"; pattern: string }
  | { type: "waitFor"; selector: string; timeoutMs?: number }
  | { type: "press"; key: string }
  | { type: "screenshot" };

export type RecipeInvoiceList = {
  rowSelector: string;
  dateSelector?: string;
  dateAttribute?: string;
  dateFormat?: string;
  downloadSelector: string;
  paginationSelector?: string;
};

export type Recipe = {
  vendorKey: string;
  loginUrl: string;
  loginFlow: RecipeStep[];
  navigationFlow: RecipeStep[];
  invoiceList: RecipeInvoiceList;
  successHeuristic?: string;
};

export type RecipeRow = {
  id: number;
  vendorKey: string;
  version: number;
  recipe: Recipe;
  recordedBy: "local" | "community";
  recordedAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  status: "active" | "broken" | "replaced";
};

export type RunMode = "replay" | "record" | "replay_then_record";
export type RunStatus =
  | "success"
  | "recipe_broken"
  | "login_required"
  | "two_factor"
  | "captcha"
  | "no_invoices"
  | "failed";

export type RunResult = {
  vendorKey: string;
  recipeId: number | null;
  mode: RunMode;
  status: RunStatus;
  invoicesFound: number;
  durationMs: number;
  errorMessage: string | null;
  llmCalls: number;
  llmCostCents: number;
  downloads: Array<{ filePath: string; invoiceDate: string | null; originalFilename: string }>;
};

export type AgentCredentials = {
  username: string;
  password: string;
  totpSecret?: string;
};
