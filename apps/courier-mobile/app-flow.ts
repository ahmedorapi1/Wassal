export type CourierScreen = 'vehicle' | 'documents' | 'review' | 'status';

export function courierScreenForState(input: {
  status: string;
  vehicleCount: number;
  documentCount: number;
  requiredDocumentCount: number;
}): CourierScreen {
  if (
    ['pending_review', 'approved', 'rejected', 'suspended'].includes(
      input.status,
    )
  ) {
    return 'status';
  }
  if (input.status === 'changes_requested') return 'documents';
  if (input.vehicleCount === 0) return 'vehicle';
  if (input.documentCount < input.requiredDocumentCount) return 'documents';
  return 'review';
}
