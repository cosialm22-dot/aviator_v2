// Operator roles never bet, deposit or claim rewards (the database enforces it; the UI stays honest).
export const OPERATOR_ROLES = ['platform_superadmin', 'platform_admin', 'super_admin', 'admin', 'finance_admin', 'support'] as const;
export function isOperatorRole(role: string | null | undefined): boolean {
  return !!role && (OPERATOR_ROLES as readonly string[]).includes(role);
}
