export type QuoteFingerprintInput = {
  addressIdentity: string;
  category: string;
  customerIdentity: string;
  declaredValueMinor: number;
  fragile: boolean;
  latitude: number;
  longitude: number;
  packageCount: number;
  packageSize: string;
  storeId: string;
  thermalBag: boolean;
  weightGrams: number;
};

export function quoteInputFingerprint(input: QuoteFingerprintInput): string {
  return JSON.stringify([
    input.storeId,
    input.customerIdentity,
    input.addressIdentity,
    Number(input.latitude.toFixed(6)),
    Number(input.longitude.toFixed(6)),
    input.category,
    input.packageSize,
    input.weightGrams,
    input.packageCount,
    input.fragile,
    input.thermalBag,
    input.declaredValueMinor,
  ]);
}

export function quoteMatchesInput(
  quoteFingerprint: string | undefined,
  currentInput: QuoteFingerprintInput,
) {
  return (
    Boolean(quoteFingerprint) &&
    quoteFingerprint === quoteInputFingerprint(currentInput)
  );
}
