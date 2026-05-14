type ProductPattern = {
  label: string;
  keywords: string[];
};

const productPatternsByVendor: Record<string, ProductPattern[]> = {
  openai: [
    { label: "chatgpt-team", keywords: ["chatgpt team"] },
    { label: "chatgpt-plus", keywords: ["chatgpt plus"] },
    { label: "chatgpt-pro", keywords: ["chatgpt pro"] },
    { label: "api", keywords: ["openai api", "api usage", "api credits", "platform.openai"] },
  ],
  anthropic: [
    { label: "claude-team", keywords: ["claude team"] },
    { label: "claude-pro", keywords: ["claude pro"] },
    { label: "api", keywords: ["anthropic api", "api credits", "console.anthropic"] },
  ],
  mistral: [
    { label: "api", keywords: ["mistral api", "api usage", "la plateforme"] },
    { label: "chat", keywords: ["le chat", "mistral chat"] },
  ],
  adobe: [
    { label: "creative-cloud", keywords: ["creative cloud"] },
    { label: "acrobat", keywords: ["acrobat"] },
    { label: "stock", keywords: ["adobe stock"] },
  ],
  hetzner: [
    { label: "cloud", keywords: ["hetzner cloud", "cloud server", "vserver"] },
    { label: "storage-box", keywords: ["storage box"] },
    { label: "robot", keywords: ["robot"] },
    { label: "domain", keywords: ["domain", "dns"] },
  ],
  webgo: [{ label: "hosting", keywords: ["hosting", "webspace"] }],
  strato: [{ label: "hosting", keywords: ["hosting", "webhosting"] }],
  hostinger: [{ label: "hosting", keywords: ["hosting", "web hosting"] }],
  raidboxes: [{ label: "hosting", keywords: ["hosting", "wordpress"] }],
  enbw: [
    { label: "strom", keywords: ["strom", "electricity"] },
    { label: "gas", keywords: ["gas"] },
    { label: "charging", keywords: ["mobility+", "laden", "charging"] },
  ],
  oura: [
    { label: "membership", keywords: ["membership"] },
    { label: "ring", keywords: ["ring"] },
  ],
  vodafone: [
    { label: "internet", keywords: ["internet", "cable"] },
    { label: "mobile", keywords: ["mobilfunk", "mobile"] },
  ],
};

export function deriveInvoiceProductLabel(input: {
  vendorKey: string | null;
  originalFilename: string;
  text: string;
}) {
  const vendorKey = input.vendorKey || "unknown-vendor";
  const haystack = `${input.originalFilename}\n${input.text}`.toLowerCase();
  const patterns = productPatternsByVendor[vendorKey] || [];

  for (const pattern of patterns) {
    if (pattern.keywords.some((keyword) => haystack.includes(keyword))) {
      return pattern.label;
    }
  }

  return "unknown-product";
}
