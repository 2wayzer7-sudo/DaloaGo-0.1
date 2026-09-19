const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

export function normalizePhoneNumber(input: string): string {
  if (typeof input !== "string") {
    throw new TypeError("Phone number must be a string");
  }

  const compact = input.trim().replace(/[().\s-]/g, "");
  const international = compact.startsWith("00") ? "+" + compact.slice(2) : compact;

  if (!E164_PATTERN.test(international)) {
    throw new Error("Invalid phone number");
  }

  return international;
}
